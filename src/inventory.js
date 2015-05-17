'use strict';

var uuidGen = require('node-uuid'),
    db = require('spacebox-common-native').db,
    Q = require('q'),
    C = require('spacebox-common')

var blueprints = require('./blueprints.js'),
    production = require('./production_dep.js'),
    daoModule = require('./dao.js')

var slice_permissions = {}

var dao = daoModule.inventory

function build_ship_doc(blueprint) {
    return {
        blueprint: blueprint
    }
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
        i.capacity.cargo = b.inventory_capacity
        i.capacity.hanger = b.hanger_capacity

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

        if (src_container !== null) {
            var src_doc = src_container.doc

            if (items.some(function(item) {
                if (item.ship !== undefined)
                    item.quantity = 1

                var slot = item.blueprint.type == "spaceship" ? "hanger" : "cargo"
                src_doc.usage[slot] = src_doc.usage[slot] - (item.blueprint.volume * item.quantity)

                if (item.ship !== undefined) {
                    return (item.ship.container_id !== src_container.id || item.ship.container_slice !== src_slice)
                } else {
                    var slice = src_doc[slot][src_slice]
                    if (slice === undefined)
                        slice = src_doc[slot][src_slice] = {}

                    if (typeof slice[item.blueprint.uuid] !== 'number')
                        slice[item.blueprint.uuid] = 0

                    slice[item.blueprint.uuid] = slice[item.blueprint.uuid] - item.quantity
                    return (src_doc[slot][src_slice][item.blueprint.uuid] < 0)
                }
            })) {
                throw new C.http.Error(409, "invalid_transaction", {
                    reason: "Not enough cargo present",
                    desired: items,
                    resulting: {
                        cargo: src_doc.cargo,
                        hanger: src_doc.hanger,
                    }
                })
            }
        }

        // dest_container and dest_slice may be null when spodb is undocking a ship
        if (dest_container !== null) {
            var dest_doc = dest_container.doc

            items.forEach(function(item) {
                if (item.ship !== undefined)
                    item.quantity = 1

                var slot = item.blueprint.type == "spaceship" ? "hanger" : "cargo"
                dest_doc.usage[slot] = dest_doc.usage[slot] + (item.blueprint.volume * item.quantity)

                if (item.ship === undefined) {
                    var slice = dest_doc[slot][dest_slice]
                    if (slice === undefined)
                        slice = dest_doc[slot][dest_slice] = {}

                    if (typeof slice[item.blueprint.uuid] !== 'number')
                        slice[item.blueprint.uuid] = 0

                    slice[item.blueprint.uuid] = slice[item.blueprint.uuid] + item.quantity
                }
            })
                
            if ((dest_doc.capacity.hanger < dest_doc.usage.hanger) ||
                (dest_doc.capacity.cargo < dest_doc.usage.cargo)) {
                throw new C.http.Error(409, "not_enough_space", {
                    inventory: dest_container.id,
                    capacity: dest_doc.capacity,
                    usage: dest_doc.usage
                })
            }
        }

        return Q(null).
        then(function() {
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
                if (item.ship !== undefined) {
                    prev = prev.then(function() {
                        return db.none("update ships set container_id = $2, container_slice = $3 where id = $1",
                                       [ item.ship.id, container_id, dest_slice ])
                    })
                }

                return prev
            }, Q(null))
        })
    },
    router: function(app) {
        // NOTE /containers endpoints are restricted to spodb and production api
        app.delete('/containers/:uuid', function(req, res) {
            C.http.authorize_req(req, true).then(function(auth) {
                var uuid = req.param('uuid')

                return dao.get(uuid).then(function(container) {
                        if (container !== undefined) {
                            if (containerAuthorized(req.ctx, container, auth)) {
                                return dao.destroy(uuid).then(function() {
                                    res.sendStatus(204)
                                })
                            } else {
                                throw new C.http.Error(403, "not_authorized", {
                                    account: auth,
                                    container: container
                                })
                            }
                        } else {
                            throw new C.http.Error(404, "no_such_container")
                        }
                    })
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })

        app.post('/spawn', function(req, res) {
            var data = req.body /* = {
                uuid: 'uuid',
                blueprint: 'uuid',
                items: []
            } */
            req.ctx.debug('inv', data)

            C.http.authorize_req(req, true).then(function(auth) {
                return db.tracing(req.ctx, function(db) {
                    return blueprints.getData().then(function(blueprints) {
                        return db.tx(function(db) {
                            var next = Q(null),
                                blueprint = blueprints[data.blueprint]

                            if (data.from !== undefined) {
                                next = next.then(function() {
                                    return dao.getForUpdateOrFail(data.from.uuid, db).
                                    then(function(container) {
                                        self.transfer(container, data.from.slice, null, null, [{
                                            blueprint: blueprint,
                                            quantity: 1
                                        }], db)
                                    })
                                })
                            }

                            if (blueprint.type === 'spaceship') {
                                next = next.then(function() {
                                    return db.none("insert into ships (id, account, container_id, container_slice, status, doc) values ($1, $2, null, null, 'undocked', $3)",
                                                   [ data.uuid, auth.account, build_ship_doc(blueprint.uuid) ])
                                })
                            }

                            return next.then(function() {
                                return buildContainer(req.ctx, data.uuid, auth.account, blueprint, db)
                            }).then(function() {
                                // This endpoint is only called for objects that
                                // didn't already exist, so there are no modules
                                if (blueprint.production !== undefined) {
                                    return production.updateFacilities(data.uuid, db)
                                }
                            }).then(function() {
                                if (data.items !== undefined && data.items.length > 0) {
                                    data.items.forEach(function(t) { t.blueprint = blueprints[t.blueprint] })

                                    return dao.getForUpdateOrFail(data.uuid, db).
                                    then(function(dest_container) {
                                        return self.transfer(null, null, dest_container, 'default', data.items, db)
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

        app.post('/containers/:uuid', function(req, res) {
            var uuid = req.param('uuid'),
            blueprintID = req.param('blueprint')

            Q.spread([blueprints.getData(), C.http.authorize_req(req, true), dao.get(uuid)], function(blueprints, auth, container) {
                var blueprint = blueprints[blueprintID]

                if (blueprint === undefined) {
                    throw new C.http.Error(422, "no_such_reference", {
                        name: "blueprint",
                        blueprint: blueprintID
                    })
                } else if (container !== undefined) {
                    if (containerAuthorized(req.ctx, container, auth)) {
                        self.updateContainer(req.ctx, container, blueprint).
                            then(function() {
                                res.sendStatus(204)
                            })
                    } else {
                        console.log(auth.account, "not authorized to update", uuid)
                        res.sendStatus(401)
                    }
                } else {
                    return buildContainer(req.ctx, uuid, auth.account, blueprint).then(function() {
                        res.sendStatus(204)
                    })
                }
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })

        function containerAuthorized(ctx, container, auth) {
            var result = (container !== undefined && container !== null && container.account == auth.account)
            if (!result)
                ctx.debug('inv', auth.account, 'not granted access to', container)
            return result
        }

        function buildContainer(ctx, uuid, account, blueprint, dbC) {
            var b = blueprint

            ctx.debug('inv', "building", uuid, "for", account)

            return dao.insert(uuid, {
                uuid: uuid,
                blueprint: b.uuid,
                account: account,
                capacity: {
                    cargo: b.inventory_capacity || 0,
                    hanger: b.hanger_capacity || 0,
                },
                usage: {
                    cargo: 0,
                    hanger: 0,
                },
                modules: [],
                cargo: {},
                hanger: {}
            }, dbC)
        }

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

            Q.spread([C.http.authorize_req(req), dao.get(uuid)], function(auth, container) {
                if (containerAuthorized(req.ctx, container, auth)) {
                    res.send(container.doc)
                } else {
                    res.sendStatus(401)
                }
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })


        // This is how spodb docks/undocks and updates ship status
        app.post('/ships/:uuid', function(req, res) {
            Q.spread([blueprints.getData(), C.http.authorize_req(req, true) ],
            function(blueprints, auth) {
                return db.tx(req.ctx, function(db) {
                    var container_slice = req.body.slice

                    return db.one("select * from ships where id = $1 and account = $2 for update", [ req.param('uuid'), auth.account ]).
                    then(function(ship) {
                        var where
                        if (ship.container_id === null) {
                            where = [ req.body.inventory, auth.account ]
                        } else {
                            where = [ ship.container_id, auth.account ]
                            container_slice = ship.container_slice
                        }

                        return Q.all([
                            ship,
                            db.one("select * from inventories where id = $1 and account = $2 for update", where)
                        ])
                    }).spread(function(ship, container) {
                        req.ctx.debug('inv', 'ship', ship)
                        req.ctx.debug('inv', 'container', container)
                        req.ctx.debug('inv', 'request', req.body)

                        if (!containerAuthorized(req.ctx, container, auth)) {
                            throw new C.http.Error(403, "not_authorized", {
                                account: auth,
                                container: container
                            })
                        }

                        var next_status = req.body.status == 'undocked' ? 'undocked' : 'docked',
                            required_status = next_status == 'undocked' ? 'docked' : 'undocked'

                        var next = db.one("update ships set status = $2, doc = $3 where id = $1 and status = $4 returning *",
                                    [ ship.id, next_status, C.deepMerge(req.body.stats || {}, ship.doc), required_status ])

                        switch(next_status) {
                            case 'undocked':
                                next = next.then(function(ship) {
                                    return self.transfer(container, container_slice, null, null, [{
                                        ship: ship,
                                        blueprint: blueprints[ship.doc.blueprint]
                                    }], db)
                                })
                                break
                            case 'docked':
                                next = next.then(function(ship) {
                                    return self.transfer(null, null, container, req.body.slice, [{
                                        ship: ship,
                                        blueprint: blueprints[ship.doc.blueprint]
                                    }], db)
                                })
                                break
                        }

                        return next.then(function() {
                            return ship
                        })
                    })
                }).then(function(ship) {
                    res.send(ship)
                })
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })

        app.get('/ships', function(req, res) {
            C.http.authorize_req(req).then(function(auth) {
                return db.query("select * from ships where account = $1", [ auth.account ]).
                then(function(data) {
                    res.send(data)
                })
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })

        // this unpacks a ship from inventory and makes it unique
        app.post('/ships', function(req, res) {
            var inventoryID = req.param('inventory'),
                sliceID = req.param('slice'),
                blueprintID = req.param('blueprint')

            Q.spread([blueprints.getData(), C.http.authorize_req(req), dao.get(inventoryID)], function(blueprints, auth, container_row) {
                var inventory = container_row.doc,
                    blueprint  = blueprints[blueprintID]

                if (!containerAuthorized(req.ctx, inventory, auth)) {
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
                } else if (inventory.hanger[sliceID] === undefined) {
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
                } else {
                    var doc = build_ship_doc(blueprintID)

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
                                db.one("insert into ships (id, account, container_id, container_slice, status, doc) values (uuid_generate_v1(), $1, null, null, 'unpacking', $2) returning *", [ container_row.account, doc ]),
                                dao.getForUpdateOrFail(inventoryID, db)
                            ], function(ship, container) {
                                return self.transfer(null, null, container, sliceID, [{
                                    blueprint: blueprint,
                                    ship : ship
                                }], db).
                            then(function() {
                                return buildContainer(req.ctx, ship.id, auth.account, blueprint, db)
                            }).then(function() {
                                // On initial spawn there are no modules
                                // so we only care about the blueprint
                                if (blueprint.production !== undefined) {
                                    return production.updateFacilities(ship.id, db)
                                }
                            }).then(function() {
                                return db.one("update ships set status = 'docked' where id = $1 and status = 'unpacking' and container_id = $2 and container_slice = $3 returning id", [ ship.id, inventoryID, sliceID ])
                            }).then(function() {
                                res.send(C.deepMerge(doc, {
                                    uuid: ship.id
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
                        ship_uuid: 'uuid'
                    }
                ]
            }

            var dataset = req.body

            Q.spread([ blueprints.getData(), C.http.authorize_req(req) ], function(blueprints, auth) {
            return db.tx(req.ctx, function(db) {
            return Q.spread([
                dao.getForUpdate(dataset.from_id, db),
                dao.getForUpdate(dataset.to_id, db)
            ], function(src_container, dest_container) {
                req.ctx.debug('inv', 'processing transfer for', auth)

                if (auth.privileged !== true) {
                    if (src_container === null || !containerAuthorized(req.ctx, src_container, auth)) {
                        throw new C.http.Error(403, "unauthorized", {
                            container: dataset.from_id,
                            account: auth.account
                        })
                    } else if (dest_container === null || !containerAuthorized(req.ctx, dest_container, auth)) {
                        throw new C.http.Error(403, "unauthorized", {
                            container: dataset.to_id,
                            account: auth.account
                        })
                    }
                }

                return Q.all(dataset.items.map(function(t) {
                    if (t.ship_uuid !== undefined) {
                        // If you want to move a ship around, it has to be docked. If spodb
                        // wants to dock/undock the ship, it uses the POST /ships/:uuid endpoint
                        return db.one("select * from ships where id = $1 and status = 'docked' for update", t.ship_uuid).
                        then(function(ship) {
                            t.blueprint = blueprints[ship.doc.blueprint]
                            t.ship = ship
                        })
                    } else {
                        if (t.blueprint !== undefined)
                            t.blueprint = blueprints[t.blueprint]

                        if (t.blueprint === undefined) {
                            throw new C.http.Error(422, "no_such_reference", {
                                name: "blueprint",
                                blueprint: t.blueprint
                            })
                        } else if (t.blueprint.volume === undefined) {
                            throw new C.http.Error(500, "invalid_blueprint", {
                                reason: "missing the volume attribute",
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
