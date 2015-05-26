'use strict';

var uuidGen = require('node-uuid'),
    db = require('spacebox-common-native').db,
    Q = require('q'),
    C = require('spacebox-common')

var blueprints = require('./blueprints.js'),
    production = require('./production_dep.js'),
    daoModule = require('./dao.js')

var dao = daoModule.inventory

function unique_item_doc(blueprint) {
    return {
        blueprint: blueprint
    }
}

function containerAuthorized(ctx, container, account) {
    var result = (container !== undefined && container !== null && container.account == account)
    if (!result)
        ctx.debug('inv', account, 'not granted access to', container)
    return result
}

function build_limits(src) {
    return {
        "moored":  src.mooring_limit || 0,
        "max_docking_size": src.max_docking_size || 0,
        "capacity": src.capacity || 0
    }
}

function buildContainerIfNeeded(ctx, uuid, account, blueprint, dbC) {
    var b = blueprint

    if (isNaN(b.capacity) || b.capacity <= 0)
        return

    ctx.debug('inv', "building", uuid, "for", account)

    return dao.insert(uuid, {
        uuid: uuid,
        blueprint: b.uuid,
        account: account,
        limits: build_limits(b),
        usage: 0,
        mooring: [],
        modules: [],
        contents: {}
    }, dbC).then(function() {
        return production.updateFacilities(uuid, dbC)
    })
}


var self = module.exports = {
    dao: dao,
    updateContainer: function(ctx, container, newBlueprint, dbC) {
        var i = container.doc,
            b = newBlueprint

        if (newBlueprint.uuid === undefined)
            throw new Error("invalid params for inventory.updateContainer")

        ctx.debug('inv', i)

        i.blueprint = newBlueprint.uuid
        i.limits = build_limits(b)

        ctx.debug('inv', i)

        return dao.update(container.id, container.doc, dbC)
    },
    transfer: function(src_container, src_slice, dest_container, dest_slice, items, db) {
        if (db === undefined)
            throw new Error("failed to pass a transaction: transfer")

        db.assertTx()
       
        if ((src_slice !== null && typeof src_slice !== 'string' ) ||
            (dest_slice !== null && typeof dest_slice !== 'string')) {
            // Lots of callers to this pass in unvalidate values for slices
            throw new Error("invalid params for transfer: src_slice="+src_slice+" dest_slice="+dest_slice)
        } else if (!Array.isArray(items)) {
            throw new Error("invalid params for transfer: items must be an array")
        }

        function default_usage_remove_calc(item) {
            src_doc.usage = src_doc.usage - (item.blueprint.size * item.quantity)

            if (isNaN(src_doc.usage))
                throw new Error("this item broke the inventory transfer"+JSON.stringify(item))
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
                console.log(src_doc)
                throw new Error("something messed up the usage")
            }
        }

        function default_usage_add_calc(item) {
            dest_doc.usage = dest_doc.usage + (item.blueprint.size * item.quantity)

            if (isNaN(dest_doc.usage))
                throw new Error("this item broke the inventory transfer"+JSON.stringify(item))
        }

        // dest_container and dest_slice may be null when spodb is deploying a vessel
        if (dest_container !== null) {
            var dest_doc = dest_container.doc

            items.forEach(function(item) {
                if (item.item !== undefined) {
                    console.log("trying to dock", item.blueprint, dest_doc.limits)
                    if (item.blueprint.type == 'vessel' &&
                        item.blueprint.size > dest_doc.limits.max_docking_size) {
                        dest_doc.mooring.push(item.item.id)
                    } else {
                        item.quantity = 1
                        default_usage_add_calc(item)
                    }
                } else {
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
                    inventory: dest_container.id,
                    capacity: dest_doc.limits,
                    usage: dest_doc.usage,
                    mooring: dest_doc.mooring,
                })
            }
        }

        return Q.fcall(function() {
            if (dest_container !== null)
                return dao.update(dest_container.id, dest_container.doc, db)
        }).then(function() {
            if (src_container !== null)
                return dao.update(src_container.id, src_container.doc, db)
        }).then(function() {
            var container_id = null

            if (dest_container !== null)
                container_id = dest_container.id

            return items.reduce(function(prev, item) {
                if (item.item !== undefined) {
                    prev = prev.then(function() {
                        return db.none("update items set container_id = $2, container_slice = $3 where id = $1",
                                       [ item.item.id, container_id, dest_slice ])
                    })
                }

                return prev
            }, Q(null))
        })
    },
    router: function(app) {
        // NOTE /vessels endpoints are restricted to spodb
        app.delete('/vessels/:uuid', function(req, res) {
            C.http.authorize_req(req, true).then(function(auth) {
                var uuid = req.param('uuid')

                return db.tx(req.ctx, function(db) {
                    return dao.getForUpdateOrFail(uuid, db).then(function(container) {
                        return Q.all([
                            db.any("select * from facilities where inventory_id = $1 for update ", uuid).
                            then(function(list) {
                                return Q.all(list.map(function(facility) {
                                    return production.destroyFacility(facility, db)
                                }))
                            }),
                            dao.destroy(uuid),
                            db.none("delete from items where id = $1", uuid)
                        ])
                    }).then(function() {
                        res.sendStatus(204)
                    })
                })
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })

        // This is how spodb docks and updates vessel status
        app.post('/vessels/:uuid', function(req, res) {
            Q.spread([blueprints.getData(), C.http.authorize_req(req, true) ],
            function(blueprints, auth) {
                return db.tx(req.ctx, function(db) {
                    return Q.spread([
                        db.one("select * from items where id = $1 and account = $2 for update", [ req.param('uuid'), req.body.account ]),
                        db.one("select * from inventories where id = $1 and account = $2 for update", [ req.body.inventory, req.body.account ])
                    ], function(vessel, container) {
                        req.ctx.debug('inv', 'vessel', vessel)
                        req.ctx.debug('inv', 'container', container)
                        req.ctx.debug('inv', 'request', req.body)

                        if (!containerAuthorized(req.ctx, container, req.body.account)) {
                            throw new C.http.Error(403, "not_authorized", {
                                account: req.body.account,
                                container: container
                            })
                        }

                        var vessel_bp = blueprints[vessel.doc.blueprint]
                        if (vessel_bp.capacity > vessel_bp.size)
                            throw new C.http.Error(422, "invalid_transaction", {
                                msg: "You can't scoop something that holds more than it's size"
                            })

                        // The inventory transfer will fail this if need be because we are
                        // in a transaction
                        return Q.all([
                            db.none("update items set doc = $2 where id = $1", [ vessel.id, C.deepMerge(req.body.stats || {}, vessel.doc) ]),
                            self.transfer(null, null, container, req.body.slice, [{
                                item: vessel,
                                blueprint: vessel_bp
                            }], db)
                        ])
                    })
                })
            }).then(function() {
                res.sendStatus(204)
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })

        // this is how spodb undocks vessels
        app.post('/vessels', function(req, res) {
            var data = req.body /* = {
                uuid: 'uuid', // uuid may already exist, but will never be null nor undefined
                account: 'uuid',
                blueprint: 'uuid',
                from: { container_id, slice },
                contents: []
            } */
            req.ctx.debug('inv', data)

            C.http.authorize_req(req, true).then(function(auth) {
                return db.tracing(req.ctx, function(db) {
                    return blueprints.getData().then(function(blueprints) {
                        return db.tx(function(db) {
                            var blueprint = blueprints[data.blueprint]

                            return Q.spread([
                                db.oneOrNone("select * from items where id = $1", data.uuid),
                                Q.fcall(function() {
                                    if (data.from.uuid === null) {
                                        if (auth.privileged !== true)
                                            throw new Error("must provide a spawn source")

                                        return null
                                    } else {
                                        return dao.getForUpdateOrFail(data.from.uuid, db)
                                    }
                                })
                            ], function(vessel, container) {
                                if (vessel !== null) {
                                    if (vessel.blueprint_id !== data.blueprint)
                                        throw new Error("invalid request")
                                    if (vessel.locked === true)
                                        throw new Error("that ship can't undock right now")

                                    return self.transfer(container, data.from.slice, null, null, [{
                                        item: vessel,
                                        blueprint: blueprints[vessel.blueprint_id]
                                    }], db)
                                } else {
                                    return self.transfer(container, data.from.slice, null, null, [{
                                        blueprint: blueprint,
                                        quantity: 1
                                    }], db).then(function() {
                                        return db.none("insert into items (id, account, blueprint_id, container_id, container_slice, doc) values ($1, $2, $3, null, null, $4)",
                                                       [ data.uuid, data.account, blueprint.uuid, unique_item_doc(blueprint.uuid) ])
                                    }).then(function() {
                                            return buildContainerIfNeeded(req.ctx, data.uuid, data.account, blueprint, db)
                                    }).then(function() {
                                        if (data.contents !== undefined && data.contents.length > 0) {
                                            data.contents.forEach(function(t) { t.blueprint = blueprints[t.blueprint] })

                                            return dao.getForUpdateOrFail(data.uuid, db).
                                            then(function(dest_container) {
                                                return self.transfer(null, null, dest_container, 'default', data.contents, db)
                                            })
                                        }
                                    })
                                }
                            })
                        })
                    })
                })
            }).then(function() {
                res.sendStatus(204)
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })

        app.get('/inventory', function(req, res) {
            C.http.authorize_req(req).then(function(auth) {
                if (auth.privileged && req.param('all') == 'true') {
                    return dao.all().then(function(data) {
                        res.send(data)
                    })
                } else {
                    return dao.all(auth.account).then(function(data) {
                        res.send(data)
                    })
                }
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })

        app.get('/inventory/:uuid', function(req, res) {
            var uuid = req.param('uuid')

            Q.spread([
                C.http.authorize_req(req),
                dao.get(uuid),
                db.many("select * from items where container_id = $1", uuid)
            ], function(auth, container, items) {
                if (containerAuthorized(req.ctx, container, auth.account)) {
                    container.doc.items = items
                    res.send(container.doc)
                } else {
                    res.sendStatus(403)
                }
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })

        // this unpacks an item from inventory and makes it unique
        app.post('/items', function(req, res) {
            var inventoryID = req.param('inventory'),
                sliceID = req.param('slice'),
                blueprintID = req.param('blueprint')

            Q.spread([blueprints.getData(), C.http.authorize_req(req), dao.get(inventoryID)], function(blueprints, auth, container_row) {
                var inventory = container_row.doc,
                    blueprint  = blueprints[blueprintID]

                if (!containerAuthorized(req.ctx, inventory, auth.account)) {
                    throw new C.http.Error(403, "unauthorized", {
                        container: container_row.account,
                        auth: auth,
                    })
                }

                if (inventory === undefined) {
                    throw new C.http.Error(422, "no_such_reference", {
                        name: "inventory",
                        inventory: inventoryID,
                        slice: sliceID
                    })
                } else if (inventory.contents[sliceID] === undefined) {
                    throw new C.http.Error(422, "no_such_reference", {
                        name: "slice",
                        inventory: inventoryID,
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

                    // TODO the tracing context should be inejected at the beginning
                    return db.tx(req.ctx, function(db) {
                        return dao.getForUpdateOrFail(inventoryID, db).
                        then(function(container) {
                            return self.transfer(container, sliceID, null, null, [{
                                blueprint: blueprint,
                                quantity: 1
                            }], db)
                        }).then(function() {
                            return Q.spread([
                                // This is in a transaction so it won't be visible until we close the transaction
                                db.one("insert into items (id, account, container_id, container_slice, doc) values (uuid_generate_v1(), $1, null, null, $2) returning *", [ container_row.account, doc ]),
                                dao.getForUpdateOrFail(inventoryID, db)
                            ], function(item, container) {
                                return self.transfer(null, null, container, sliceID, [{
                                    blueprint: blueprint,
                                    item: item
                                }], db).
                                then(function() {
                                    return buildContainerIfNeeded(req.ctx, item.id, auth.account, blueprint, db)
                                }).then(function() {
                                    if (blueprint.production !== undefined)
                                        return production.updateFacilities(item.id, db)
                                }).then(function() {
                                    res.send(C.deepMerge(doc, {
                                        uuid: item.id
                                    }))
                                })
                            })
                        })
                    })
                }
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })

        // TODO support a schema validation
        app.post('/inventory', function(req, res) {
            req.ctx.debug('inv', req.body)
            var example = {
                from_id: 'uuid',
                from_slice: 'default',
                to_id: 'uuid',
                to_slice: 'default',
                items: [
                    {
                        blueprint: 'uuid',
                        quantity: 3
                    },
                    {
                        item_uuid: 'uuid'
                    }
                ]
            }

            var dataset = req.body

            Q.spread([ blueprints.getData(), C.http.authorize_req(req) ], function(blueprints, auth) {
            return db.tx(req.ctx, function(db) {
            return Q.spread([
                dao.getForUpdate(dataset.from_id, db),
                dao.getForUpdate(dataset.to_id, db),
                db.oneOrNone("select * from items where id = $1", dataset.from_id),
                db.oneOrNone("select * from items where id = $1", dataset.to_id),
            ], function(src_container, dest_container, src_vessel, dest_vessel) {
                req.ctx.debug('inv', 'processing transfer for', auth)

                if (auth.privileged !== true) {
                    if (src_container === null || !containerAuthorized(req.ctx, src_container, auth.account)) {
                        throw new C.http.Error(403, "unauthorized", {
                            container: dataset.from_id,
                            account: auth.account
                        })
                    } else if (dest_container === null || !containerAuthorized(req.ctx, dest_container, auth.account)) {
                        throw new C.http.Error(403, "unauthorized", {
                            container: dataset.to_id,
                            account: auth.account
                        })
                    } else if(
                        // The vessel doesn't need to be in any particular slice, just
                        // in the structure generally. Either one can be inside the other
                        // for this to work
                        (src_vessel === null || src_vessel.container_id !== dest_container.id) &&
                        (dest_vessel === null || dest_vessel.container_id !== src_container.id)
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
                            t.blueprint = blueprints[item.doc.blueprint]
                            t.item = item
                        })
                    } else {
                        if (t.blueprint !== undefined)
                            t.blueprint = blueprints[t.blueprint]

                        if (t.blueprint === undefined) {
                            throw new C.http.Error(422, "no_such_reference", {
                                name: "blueprint",
                                blueprint: t.blueprint
                            })
                        } else if (t.blueprint.size === undefined) {
                            throw new C.http.Error(500, "invalid_blueprint", {
                                reason: "missing the size attribute",
                                blueprint: t.blueprint
                            })
                        }
                    }
                })).then(function() {
                    return self.transfer(src_container, dataset.from_slice, dest_container, dataset.to_slice, dataset.items, db)
                }).then(function() {
                    res.sendStatus(204)
                })
            })
            })
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })
    }
}
