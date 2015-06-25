'use strict';

var Q = require('q')
var C = require('spacebox-common')
var uuidGen = require('node-uuid')
var async = require('async-q')

var config = require('./config.js')
var db = config.db
var production = require('./production_dep.js')

function unique_item_doc(blueprint) {
    return {
        blueprint: blueprint
    }
}

function containerAuthorized(ctx, container, agent_id) {
    var result = (container !== undefined && container !== null && container.agent_id == agent_id)
    if (!result)
        ctx.warn({ agent_id: agent_id, container_agent_id: container.agent_id }, 'container access denied')
    return result
}

function build_limits(src) {
    return {
        "moored": src.mooring_limit || 0,
        "max_docking_size": src.max_docking_size || 0,
        "capacity": src.capacity || 0
    }
}

function buildContainerIfNeeded(ctx, uuid, agent_id, blueprint, db) {
    var b = blueprint

    if (isNaN(b.capacity) || b.capacity <= 0)
        return

    ctx.debug({ uuid: uuid, agent_id: agent_id }, 'building container')

    return db.inventory.insert(uuid, {
        uuid: uuid,
        blueprint: b.uuid,
        agent_id: agent_id,
        limits: build_limits(b),
        usage: 0,
        mooring: [],
        modules: [],
        contents: {}
    }).then(function() {
        return production.updateFacilities(uuid, db)
    })
}

var self = module.exports = {
    dockVessel: function(ctx, uuid, data) {
        return db.tx(ctx, function(db) {
            return Q.spread([
                db.one("select * from items where id = $1 and agent_id = $2 for update", [uuid, data.agent_id]),
                db.one("select * from containers where id = $1 and agent_id = $2 for update", [data.container_id, data.agent_id])
            ], function(vessel, container) {
                ctx.trace({ vessel: vessel, container: container }, 'dockVessel')

                if (!containerAuthorized(ctx, container, data.agent_id)) {
                    throw new C.http.Error(403, "not_authorized", {
                        agent_id: data.agent_id,
                        container: container
                    })
                }

                return db.blueprints.get(vessel.doc.blueprint).
                then(function(bp) {
                    return [vessel, bp, container]
                })
            }).spread(function(vessel, vessel_bp, container) {
                // The inventory transfer will fail this if need be because we are
                // in a transaction
                return Q.all([
                    db.none("update items set doc = $2 where id = $1", [vessel.id, C.deepMerge(data.stats || {}, vessel.doc)]),
                    self.transfer(null, null, container, data.slice, [{
                        item: vessel,
                        blueprint: vessel_bp
                    }], db)
                ])
            })
        })
    },
    spawnVessel: function(ctx, data) {
        return db.tx(ctx, function(db) {
            return Q.spread([
                db.oneOrNone("select * from items where id = $1", data.uuid),
                db.inventory.get(data.uuid, db),
                db.blueprints.get(data.blueprint),
                Q.fcall(function() {
                    if (data.from.uuid === null) {
                        return null
                    } else {
                        return db.inventory.getForUpdateOrFail(data.from.uuid, db)
                    }
                })
            ], function(vessel, vessel_container, blueprint, src_container) {
                if (vessel !== null) {
                    if (vessel.blueprint_id !== blueprint.uuid)
                        throw new Error("invalid request")
                    if (vessel.locked === true)
                        throw new Error("that ship can't undock right now")

                    return Q.fcall(function() {
                        if (src_container !== null)
                            return self.transfer(src_container, data.from.slice, null, null, [{
                                item: vessel,
                                blueprint: blueprint,
                            }], db)
                    }).then(function() {
                        return {
                            blueprint_id: vessel.blueprint_id,
                            modules: vessel_container.doc.modules
                        }
                    })
                } else {
                    return Q.fcall(function() {
                        if (src_container !== null)
                            return self.transfer(src_container, data.from.slice, null, null, [{
                                blueprint: blueprint,
                                quantity: 1
                            }], db)
                    }).then(function() {
                        return db.none("insert into items (id, agent_id, blueprint_id, container_id, container_slice, doc) values ($1, $2, $3, null, null, $4)", [data.uuid, data.agent_id, blueprint.uuid, unique_item_doc(blueprint.uuid)])
                    }).then(function() {
                        return buildContainerIfNeeded(ctx, data.uuid, data.agent_id, blueprint, db)
                    }).then(function() {
                        if (data.modules !== undefined && data.modules.length > 0) {
                            return Q.spread([
                                db.inventory.getForUpdateOrFail(data.uuid, db),
                                db.blueprints.getMany(data.modules)
                            ], function(dest_container, list) {
                                return self.setModules(dest_container, list, db)
                            })
                        }
                    }).then(function() {
                        return {
                            blueprint_id: blueprint.uuid,
                            modules: data.modules
                        }
                    })
                }
            })
        })
    },
    updateContainer: function(ctx, container, newBlueprint, db) {
        var i = container.doc,
            b = newBlueprint

        if (newBlueprint.uuid === undefined)
            throw new Error("invalid params for inventory.updateContainer")

        ctx.trace({ container: i }, 'updateContainer:before')

        i.blueprint = newBlueprint.uuid
        i.limits = build_limits(b)

        ctx.trace({ container: i }, 'updateContainer:after')

        return db.inventory.update(container.id, container.doc)
    },
    recalculateCargoUsage: function(ctx, container, db) {
        db.assertTx()

        var newUsage = 0

        return async.eachSeries(
            Object.keys(container.doc.contents),
            function(key) {
                var slice = container.doc.contents[key]
                return async.eachSeries(
                    Object.keys(slice),
                    function(key) {
                        var count = slice[key]

                        return db.blueprints.get(key).
                        then(function(blueprint) {
                            newUsage = newUsage + blueprint.size * count
                        })
                    })
            }).
        then(function() {
            container.doc.usage = newUsage
        }).then(function() {
            return db.inventory.update(container.id, container.doc)
        })
    },
    setModules: function(container, list, db) {
        db.assertTx()

        var modules = [],
            blueprints = {}

        list.forEach(function(b) {
            modules.push(b.uuid)
            blueprints[b.uuid] = b
        })

        var changes = C.compute_array_changes(container.doc.modules, modules)

        container.doc.modules = modules
        container.doc.usage = changes.added.reduce(function(acc, uuid, i) {
            return (acc + blueprints[uuid].size)
        }, container.doc.usage)

        db.ctx.trace({ modules: container.doc.modules, contents: container.doc.contents }, 'setModules')

        return db.inventory.update(container.id, container.doc, db).
        then(function() {
            return production.updateFacilities(container.id, db)
        })
    },
    transfer: function(src_container, src_slice, dest_container, dest_slice, items, db) {
        if (db === undefined)
            throw new Error("failed to pass a transaction: transfer")

        db.assertTx()

        if ((src_slice !== null && typeof src_slice !== 'string') ||
            (dest_slice !== null && typeof dest_slice !== 'string')) {
            // Lots of callers to this pass in unvalidate values for slices
            throw new Error("invalid params for transfer: src_slice=" + src_slice + " dest_slice=" + dest_slice)
        } else if (!Array.isArray(items)) {
            throw new Error("invalid params for transfer: items must be an array")
        }

        db.ctx.trace({ items: items }, 'transfer items')

        function default_usage_remove_calc(item) {
            src_doc.usage = src_doc.usage - (item.blueprint.size * item.quantity)

            if (isNaN(src_doc.usage))
                throw new Error("this item broke the inventory transfer: " + JSON.stringify(item))
        }

        if (src_container !== null) {
            var src_doc = src_container.doc

            if (items.some(function(item) {
                    if (item.item !== undefined) {
                        // Don't worry about testing if it's a vessel, it won't
                        // be in the list if it isn't
                        var i = src_doc.mooring.indexOf(item.item.id)

                        if (i > -1) {
                            src_doc.mooring.splice(i, 1)
                        } else {
                            item.quantity = 1
                            default_usage_remove_calc(item)
                        }

                        return (item.item.container_id !== src_container.id || item.item.container_slice !== src_slice || item.item.locked === true)
                    } else {
                        C.assertUUID(item.blueprint.uuid)
                        default_usage_remove_calc(item)

                        var slice = src_doc.contents[src_slice]
                        if (slice === undefined)
                            slice = src_doc.contents[src_slice] = {}

                        if (typeof slice[item.blueprint.uuid] !== 'number')
                            slice[item.blueprint.uuid] = 0

                        slice[item.blueprint.uuid] = slice[item.blueprint.uuid] - item.quantity
                        var not_enough_bool = (isNaN(src_doc.contents[src_slice][item.blueprint.uuid]) || src_doc.contents[src_slice][item.blueprint.uuid] < 0)

                        if (src_doc.contents[src_slice][item.blueprint.uuid] === 0)
                            delete src_doc.contents[src_slice][item.blueprint.uuid]

                        return not_enough_bool
                    }
                })) {
                throw new C.http.Error(409, "invalid_transaction", {
                    reason: "Not enough contents present",
                    desired: items,
                    contents: src_doc.contents,
                })
            }

            if (isNaN(src_doc.usage) || src_doc.usage < 0) {
                db.ctx.warn({ src_doc: src_doc }, "something messed up the usage")
                throw new Error("something messed up the usage")
            }
        }

        function default_usage_add_calc(item) {
            dest_doc.usage = dest_doc.usage + (item.blueprint.size * item.quantity)

            if (isNaN(dest_doc.usage))
                throw new Error("this item broke the inventory transfer" + JSON.stringify(item))
        }

        // dest_container and dest_slice may be null when spodb is deploying a vessel
        if (dest_container !== null) {
            var dest_doc = dest_container.doc

            items.forEach(function(item) {
                if (item.item !== undefined) {
                    db.ctx.trace({ blueprint: item.blueprint, limits: dest_doc.limits }, 'handling an item')
                        // TODO how do we scoop something that is larger than it's
                        // capacity?
                    if (item.blueprint.type == 'vessel' && (
                            item.blueprint.size > dest_doc.limits.max_docking_size ||
                            item.blueprint.size < item.blueprint.capacity
                        )) {
                        dest_doc.mooring.push(item.item.id)
                    } else {
                        item.quantity = 1
                        default_usage_add_calc(item)
                    }
                } else {
                    C.assertUUID(item.blueprint.uuid)

                    var slice = dest_doc.contents[dest_slice]
                    if (slice === undefined)
                        slice = dest_doc.contents[dest_slice] = {}

                    if (typeof slice[item.blueprint.uuid] !== 'number')
                        slice[item.blueprint.uuid] = 0

                    slice[item.blueprint.uuid] = slice[item.blueprint.uuid] + item.quantity

                    default_usage_add_calc(item)
                }
            })

            if (isNaN(dest_doc.usage) ||
                dest_doc.usage > dest_doc.limits.capacity ||
                dest_doc.mooring.length > dest_doc.limits.moored) {
                throw new C.http.Error(409, "not_enough_space", {
                    container_id: dest_container.id,
                    capacity: dest_doc.limits,
                    usage: dest_doc.usage,
                    mooring: dest_doc.mooring,
                })
            }
        }

        return Q.fcall(function() {
            if (dest_container !== null)
                return db.inventory.update(dest_container.id, dest_container.doc, db)
        }).then(function() {
            if (src_container !== null)
                return db.inventory.update(src_container.id, src_container.doc, db)
        }).then(function() {
            var container_id = null

            if (dest_container !== null)
                container_id = dest_container.id

            // This is a transaction connection, so do it in series
            return async.eachSeries(items, function(item) {
                if (item.item !== undefined) {
                    return db.none("update items set container_id = $2, container_slice = $3 where id = $1", [item.item.id, container_id, dest_slice])
                }
            })
        })
    },
    getStarterData: function(ctx, uuid, agent_id) {
        var loadout = config.game.starter_loadout

        return db.blueprints.all().then(function(blueprints) {
            var blueprint = C.find(blueprints, loadout.blueprint_query)

            return db.tx(ctx, function(db) {
                return db.one("select count(*) as count from items where agent_id = $1", agent_id).
                then(function(row) {
                    if (row.count > 0)
                        throw new C.http.Error(403, "invalid_request", {
                            msg: "This agent_id already has assets"
                        })
                }).then(function() {
                    return db.none("insert into items (id, agent_id, blueprint_id, container_id, container_slice, doc) values ($1, $2, $3, null, null, $4)", [uuid, agent_id, blueprint.uuid, unique_item_doc(blueprint.uuid)])
                }).then(function() {
                    return buildContainerIfNeeded(ctx, uuid, agent_id, blueprint, db)
                }).then(function() {
                    return db.inventory.getForUpdateOrFail(uuid, db).
                    then(function(dest_container) {
                        return self.transfer(null, null, dest_container, 'default',
                            loadout.contents.map(function(obj) {
                                return {
                                    blueprint: C.find(blueprints, obj.query),
                                    quantity: obj.quantity
                                }
                            }), db)
                    })
                })
            }).then(function() {
                return {
                    blueprint_id: blueprint.uuid,
                    modules: blueprint.native_modules || []
                }
            })
        })
    },
    router: function(app) {
        app.get('/inventory', function(req, res, next) {
            Q.fcall(function() {
                if (req.auth.privileged && req.param('all') == 'true') {
                    return db.inventory.all().then(function(data) {
                        res.json(data)
                    })
                } else {
                    return db.inventory.all(req.auth.agent_id).then(function(data) {
                        res.json(data)
                    })
                }
            }).fail(next).done()
        })

        app.get('/inventory/:uuid', function(req, res, next) {
            var uuid = req.param('uuid')

            Q.spread([
                db.inventory.get(uuid),
                db.any("select * from items where container_id = $1", uuid)
            ], function(container, items) {
                if (containerAuthorized(req.ctx, container, req.auth.agent_id)) {
                    container.doc.items = items
                    res.json(container.doc)
                } else {
                    res.sendStatus(403)
                }
            }).fail(next).done()
        })

        // this unpacks an item from container and makes it unique
        app.post('/items', function(req, res, next) {
            var inventoryID = req.param('container_id'),
                sliceID = req.param('slice'),
                blueprintID = req.param('blueprint')
                // TODO the tracing context should be inejected at the beginning
            db.tx(req.ctx, function(db) {
                return Q.spread([db.blueprints.get(blueprintID), db.inventory.getForUpdateOrFail(inventoryID, db)], function(blueprint, container_row) {
                    var inventory = container_row.doc

                    if (!containerAuthorized(req.ctx, inventory, req.auth.agent_id)) {
                        throw new C.http.Error(403, "unauthorized", {
                            container: container_row.agent_id,
                            auth: req.auth,
                        })
                    }

                    if (inventory.contents[sliceID] === undefined) {
                        throw new C.http.Error(422, "no_such_reference", {
                            name: "slice",
                            container_id: inventoryID,
                            slice: sliceID
                        })
                    } else if (blueprint === undefined) {
                        throw new C.http.Error(422, "no_such_reference", {
                            name: "blueprint",
                            blueprint: blueprintID
                        })
                    } else if (blueprint.type !== 'vessel') {
                        // With time what items can be unique may expand
                        throw new C.http.Error(422, "invalid_blueprint", {
                            msg: "you may only unpack vessels",
                            name: "blueprint",
                            blueprint: blueprintID
                        })
                    } else {
                        var doc = unique_item_doc(blueprintID)
                        return self.transfer(container_row, sliceID, null, null, [{
                            blueprint: blueprint,
                            quantity: 1
                        }], db).
                        then(function() {
                            return Q.spread([
                                // This is in a transaction so it won't be visible until we close the transaction
                                db.one("insert into items (id, agent_id, blueprint_id, container_id, container_slice, doc) values (uuid_generate_v1(), $1, $2, null, null, $3) returning *", [container_row.agent_id, blueprint.uuid, doc]),
                                db.inventory.getForUpdateOrFail(inventoryID, db)
                            ], function(item, container) {
                                return self.transfer(null, null, container, sliceID, [{
                                    blueprint: blueprint,
                                    item: item
                                }], db).
                                then(function() {
                                    return buildContainerIfNeeded(req.ctx, item.id, req.auth.agent_id, blueprint, db)
                                }).then(function() {
                                    res.json(C.deepMerge(doc, {
                                        uuid: item.id
                                    }))
                                })
                            })
                        })
                    }
                })
            }).fail(next).done()
        })

        app.post('/inventory', function(req, res, next) {
            var example = {
                from_id: 'uuid',
                from_slice: 'default',
                to_id: 'uuid',
                to_slice: 'default',
                items: [{
                    blueprint: 'uuid',
                    quantity: 3
                }, {
                    item_uuid: 'uuid'
                }]
            }

            var dataset = req.body

            if (dataset.from_id === undefined)
                dataset.from_id = null
            if (dataset.from_slice === undefined || dataset.from_id === null)
                dataset.from_slice = null

            if (dataset.to_id === undefined)
                dataset.to_id = null
            if (dataset.to_slice === undefined || dataset.to_id === null)
                dataset.to_slice = null

            return db.tx(req.ctx, function(db) {
                return Q.spread([
                    db.inventory.getForUpdate(dataset.from_id, db),
                    db.inventory.getForUpdate(dataset.to_id, db),
                    db.oneOrNone("select * from items where id = $1", dataset.from_id),
                    db.oneOrNone("select * from items where id = $1", dataset.to_id),
                ], function(src_container, dest_container, src_vessel, dest_vessel) {
                    if (req.auth.privileged !== true) {
                        if (src_container === null || !containerAuthorized(req.ctx, src_container, req.auth.agent_id)) {
                            throw new C.http.Error(403, "unauthorized", {
                                container: dataset.from_id,
                                agent_id: req.auth.agent_id
                            })
                        } else if (dest_container !== null && !containerAuthorized(req.ctx, dest_container, req.auth.agent_id)) {
                            throw new C.http.Error(403, "unauthorized", {
                                container: dataset.to_id,
                                agent_id: req.auth.agent_id
                            })
                        } else if (
                            // The vessel doesn't need to be in any particular slice, just
                            // in the structure generally. Either one can be inside the other
                            // for this to work
                            dest_container !== null &&
                            (src_vessel.container_id !== dest_container.id) &&
                            (dest_vessel.container_id !== src_container.id)
                        ) {
                            throw new C.http.Error(422, "invalid_transaction", {
                                msg: "you can only transfer between a vessel and the structure it is docked at",
                                src_vessel: src_vessel,
                                dest_vessel: dest_vessel,
                                src_container: src_container,
                                dest_container: dest_container,
                            })
                        }
                    }

                    return Q.all(dataset.items.map(function(t) {
                        if (t.item_uuid !== undefined) {
                            return db.one("select * from items where id = $1 for update", t.item_uuid).
                            then(function(item) {
                                return db.blueprints.get(item.doc.blueprint).
                                then(function(blueprint) {
                                    return [item, blueprint]
                                })
                            }).spread(function(item, blueprint) {
                                t.blueprint = blueprint
                                t.item = item
                            })
                        } else {
                            if (t.blueprint !== undefined)
                                return db.blueprints.get(t.blueprint).
                            then(function(blueprint) {
                                t.blueprint = blueprint
                            })
                        }
                    })).then(function() {
                        return self.transfer(src_container, dataset.from_slice, dest_container, dataset.to_slice, dataset.items, db)
                    }).then(function() {
                        res.sendStatus(204)
                    })
                })
            }).fail(next).done()
        })
    }
}
