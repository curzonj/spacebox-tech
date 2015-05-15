'use strict';

var npm_debug = require('debug'),
    log = npm_debug('inv:info'),
    error = npm_debug('inv:error'),
    debug = npm_debug('inv:debug'),
    uuidGen = require('node-uuid'),
    db = require('spacebox-common-native').db,
    Q = require('q'),
    C = require('spacebox-common')

var blueprints = require('./blueprints.js'),
    production = require('./production_dep.js')

var slice_permissions = {}

var dao = {
    all: function(account) {
        if (account === undefined) {
            return db.query("select * from inventories")
        } else {
            return db.query("select * from inventories where account=$1", [ account ])
        }
    },
    get: function(uuid, dbC) {
        return (dbC || db).oneOrNone("select * from inventories where id=$1", [ uuid ])
    },
    update: function(uuid, doc, dbC) {
        return (dbC || db).
            query("update inventories set doc = $2 where id =$1", [ uuid, doc ])
    },
    insert: function(uuid, doc) {
        return db.
            query("insert into inventories (id, account, doc) values ($1, $2, $3)",
                  [ uuid, doc.account, doc ])
    },
    destroy: function (uuid) {
        // TODO this should also require that the container is empty
        return db.query("delete from inventories where id = $1", [ uuid ])
    }
}

var self = module.exports = {
    dao: dao,
    updateContainer: function(container, newBlueprint) {
        var i = container.doc,
            b = newBlueprint

        debug(i)

        i.blueprint = newBlueprint.uuid
        i.capacity.cargo = b.inventory_capacity
        i.capacity.hanger = b.hanger_capacity

        debug(i)

        return dao.update(container.id, container.doc)
    },
    transaction: function(transfers, dbC) {
        return (dbC || db).tx(function(db) {
            return Q.all(transfers.map(function(transfer) {
                var example = {
                    inventory: 'uuid',
                    slice: 'uuid',
                    quantity: 5,
                    blueprint: {},
                    ship_uuid: 'uuid' // only for unpacked ships, quantity is ignored
                }

                var next = Q(null),
                    t = transfer

                if (transfer.ship_uuid !== undefined) {
                    next = next.then(function() {
                        return Q.all([
                            db.oneOrNone("select * from inventories where id = $1 for update", transfer.current_location),
                            db.oneOrNone("select * from ships where id = $1 and status = $2 for update", [ t.ship_uuid, t.required_status ])
                        ]).spread(function(container, ship) {
                            if (ship === null) {
                                throw new C.http.Error(422, "no_such_reference", {
                                    msg: "the ship is missing",
                                    ship: ship
                                })
                            } else if(ship.container_id !== t.current_location ||
                                      ship.container_slice !== t.current_slice) {
                                throw new C.http.Error(422, "no_such_reference", {
                                    msg: "the ship is out of place",
                                    ship: ship,
                                    transaction: t
                                })
                            }

                            if (transfer.ship_uuid !== undefined)
                                t.quantity = 1

                            if (container !== null) {
                                var inventory = container.doc
                                inventory.usage.hanger = inventory.usage.hanger - transfer.blueprint.volume

                                return dao.update(container.id, inventory, db)
                            }
                        })
                    })
                }

                if (transfer.ship_uuid === undefined || transfer.inventory !== null) {
                    next = next.then(function() {
                        return db.one("select * from inventories where id = $1 for update", transfer.inventory)
                    }).then(function(data) {
                        var inventory = data.doc,
                            quantity = transfer.quantity,
                            type = transfer.blueprint.uuid,
                            slot = transfer.blueprint.type == "spaceship" ? "hanger" : "cargo"

                        var volume = quantity * transfer.blueprint.volume
                        var final_volume = inventory.usage[slot] + volume
                        
                        // TODO update final volume on ship transfers, sliceID and inventoryID may be null

                        if (final_volume > inventory.capacity[slot]) {
                            throw new C.http.Error(409, "not_enough_space", {
                                inventory: data.id,
                                final_volume: final_volume,
                                capacity: inventory.capacity[slot]
                            })
                        }

                        if (transfer.ship_uuid === undefined) {
                            var sliceID = transfer.slice,
                                slice = inventory[slot][sliceID]

                            if (slice === undefined) {
                                slice = inventory[slot][sliceID] = {}
                            }

                            if (slice[type] === undefined) {
                                slice[type] = 0
                            }

                            var result = slice[type] + transfer.quantity

                            if (result < 0) {
                                throw new C.http.Error(409, "invalid_transaction", {
                                    reason: "Not enough cargo present",
                                    blueprint: type,
                                    desired: transfer.quantity,
                                    contents: slice
                                })
                            }

                            slice[type] = result
                        }

                        inventory.usage[slot] = final_volume

                        return dao.update(transfer.inventory, inventory, db)
                    })
                }
                    
                if (transfer.ship_uuid !== undefined) {
                    next = next.then(function() {
                        var t = transfer
                        // t.inventory and t.slice may be null when spodb is undocking a ship
                        //
                        // The ship was selected for update, meaning it is locked and we can
                        // safely update it without wondering if someone changed it in
                        // the mean time
                        return db.none("update ships set container_id = $2, container_slice = $3 where id = $1", [ t.ship_uuid, t.inventory, t.slice ])
                    })
                }

                return next
            }))
        })
    },
    router: function(app) {
        // NOTE /containers endpoints are restricted to spodb and production api
        app.delete('/containers/:uuid', function(req, res) {
            C.http.authorize_req(req, true).then(function(auth) {
                var uuid = req.param('uuid')

                return dao.get(uuid).then(function(container) {
                        if (container !== undefined) {
                            if (containerAuthorized(container, auth)) {
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
            }).fail(C.http.errHandler(req, res, error)).done()
        })

        app.post('/spawn', function(req, res) {
            var data = req.body /* = {
                uuid: 'uuid',
                blueprint: 'uuid',
                transactions: []
            } */
            debug(data)

            Q.spread([blueprints.getData(), C.http.authorize_req(req, true)], function(blueprints, auth) {
                var blueprint = blueprints[data.blueprint]
                return buildContainer(data.uuid, auth.account, blueprint).
                    then(function() {
                        var list = data.transactions
                        list.forEach(function(t) { t.blueprint = blueprints[t.blueprint] })
                        return self.transaction(list)
                    }).then(function() {
                        if (blueprint.production !== undefined) {
                            return production.updateFacility(data.uuid, blueprint, auth.account)
                        }
                    })
            }).then(function() {
                res.sendStatus(204)
            }).fail(C.http.errHandler(req, res, error)).done()
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
                    if (containerAuthorized(container, auth)) {
                        self.updateContainer(container, blueprint).
                            then(function() {
                                res.sendStatus(204)
                            })
                    } else {
                        console.log(auth.account, "not authorized to update", uuid)
                        res.sendStatus(401)
                    }
                } else {
                    return buildContainer(uuid, auth.account, blueprint).then(function() {
                        res.sendStatus(204)
                    })
                }
            }).fail(C.http.errHandler(req, res, error)).done()
        })

        function containerAuthorized(container, auth) {
            var result = (container !== undefined && container.account == auth.account)
            if (!result)
                debug(auth.account, 'not granted access to', container)
            return result
        }

        function buildContainer(uuid, account, blueprint) {
            var b = blueprint

            debug("building", uuid, "for", account)

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
            })
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
            }).fail(C.http.errHandler(req, res, error)).done()
        })

        app.get('/inventory/:uuid', function(req, res) {
            var uuid = req.param('uuid')

            Q.spread([C.http.authorize_req(req), dao.get(uuid)], function(auth, container) {
                if (containerAuthorized(container, auth)) {
                    res.send(container.doc)
                } else {
                    res.sendStatus(401)
                }
            }).fail(C.http.errHandler(req, res, error)).done()
        })


        // This is how spodb docks/undocks and updates ship status
        app.post('/ships/:uuid', function(req, res) {
            db.tx(function(db) {
                return Q.spread([blueprints.getData(),
                    C.http.authorize_req(req, true),
                ], function(blueprints, auth) {
                    return db.one("select * from ships where id = $1 and account = $2 for update", [ req.param('uuid'), auth.account ]).
                        then(function(ship) {
                            var where
                            if (ship.container_id === null) {
                                where = [ req.body.inventory, auth.account ]
                            } else {
                                where = [ ship.container_id, auth.account ]
                            }

                            return Q.all([
                                blueprints,
                                auth,
                                ship,
                                db.one("select * from inventories where id = $1 and account = $2", where)
                            ])
                        })
                }).spread(function(blueprints, auth, ship, container) {
                    debug('ship', ship)
                    debug('container', container)
                    debug('request', req.body)

                    if (!containerAuthorized(container, auth)) {
                        throw new C.http.Error(403, "not_authorized", {
                            account: auth,
                            container: container
                        })
                    }

                    var transaction = {
                        current_location: ship.container_id,
                        current_slice: ship.container_slice,
                        ship_uuid: ship.id,
                        blueprint: blueprints[ship.doc.blueprint]
                    }

                    switch(req.body.status) {
                        case 'undocked':
                            if (ship.status !== 'docked')
                                throw new C.http.Error(409, "invalid_state_change", {
                                    name: "ship",
                                    ship: ship,
                                })

                            C.deepMerge({
                                required_status: 'docked',
                                inventory: null,
                                slice: null
                            }, transaction)
                            break
                        case 'docked':
                            if (ship.status !== 'undocked')
                                throw new C.http.Error(409, "invalid_state_change", {
                                    name: "ship",
                                    ship: ship,
                                })

                            C.deepMerge({
                                required_status: 'undocked',
                                inventory: req.body.inventory,
                                slice: req.body.slice,
                            }, transaction)
                            break
                        default:
                            throw new C.http.Error(422, "invalid_state_change")
                    }

                    // by using the transaction function we make sure that the inventory
                    // usage is checked and updated in a single place
                    return self.transaction([transaction], db).
                    then(function() {
                        return db.one("update ships set status = $2, doc = $3 where id = $1 and status = $4 returning *",
                                [ ship.id, req.body.status, C.deepMerge(req.body.stats || {}, ship.doc), transaction.required_status ])
                    }).then(function(ship) {
                        res.send(ship)
                    })
                })
            }).fail(C.http.errHandler(req, res, error)).done()
        })

        app.get('/ships', function(req, res) {
            C.http.authorize_req(req).then(function(auth) {
                return db.query("select * from ships where account = $1", [ auth.account ]).
                then(function(data) {
                    res.send(data)
                })
            }).fail(C.http.errHandler(req, res, error)).done()
        })

        // this unpacks a ship from inventory and makes it unique
        app.post('/ships', function(req, res) {
            var inventoryID = req.param('inventory'),
                sliceID = req.param('slice'),
                blueprintID = req.param('blueprint')

            Q.spread([blueprints.getData(), C.http.authorize_req(req), dao.get(inventoryID)], function(blueprints, auth, container_row) {
                var inventory = container_row.doc

                if (!containerAuthorized(inventory, auth)) {
                    throw new C.http.Error(403, "unauthorized", {
                        container: container_row.account,
                        auth: auth,
                    })
                }

                var blueprint  = blueprints[blueprintID]

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
                    var doc = {
                        blueprint: blueprintID
                    }

                    return db.tx(function(db) {
                        return db.one("insert into ships (id, account, container_id, container_slice, status, doc) values (uuid_generate_v1(), $1, null, null, 'unpacking', $2) returning id", [ container_row.account, doc ]).
                        then(function(data) {
                            var uuid = data.id
                       
                            // the transaction will lock it for us
                            return self.transaction([{
                                inventory: inventoryID,
                                slice: sliceID,
                                quantity: -1,
                                blueprint: blueprint
                            }, {
                                inventory: inventoryID,
                                slice: sliceID,
                                quantity: 1,
                                blueprint: blueprint,
                                required_status: 'unpacking',
                                current_location: null,
                                current_slice: null,
                                ship_uuid: uuid
                            }], db).then(function() {
                                return buildContainer(uuid, auth.account, blueprint)
                            }).then(function() {
                                return db.one("update ships set status = 'docked' where id = $1 and status = 'unpacking' and container_id = $2 and container_slice = $3 returning id", [ uuid, inventoryID, sliceID ])
                            }).then(function() {
                                res.send(C.deepMerge(doc, {
                                    uuid: uuid
                                }))
                            })
                        })
                    })
                }
            }).fail(C.http.errHandler(req, res, error)).done()
        })

        // TODO support a schema validation
        app.post('/inventory', function(req, res) {
            debug(req.body)

            Q.spread([blueprints.getData(), C.http.authorize_req(req)], function(blueprints, auth) {
                var dataset = req.body,
                    transactions = [],
                    containers = [],
                    new_containers = [],
                    old_containers = []

                debug('processing transaction for', auth)

                dataset.forEach(function(t) {
                    t.blueprint = blueprints[t.blueprint]

                    if (t.blueprint === undefined)
                        throw new C.http.Error(422, "no_such_reference", {
                            name: "blueprint",
                            blueprint: t.blueprint
                        })
                })

                // TODO this method of authorization doesn't allow
                // cross account trades

                var example_container = {
                    uuid: 'uuid',
                    container_action: 'create|destroy',
                    blueprint: 'uuid'
                }
                dataset.forEach(function(t) {
                    if (t.container_action === undefined) return

                    //This is currently unpriviliged because spodb isn't ready
                    //yet. But that's ok because the balanced transactions below
                    //make sure that it must already exist to be deployed.
                    /*if (auth.priviliged === true) {
                    // Because spodb does it when it deploys things from inventory
                    throw new Error("not authorized to create containers")
                    }*/

                    if (t.container_action == "create") {
                        new_containers.push(t.uuid)
                    } else {
                        old_containers.push(t.uuid)

                        if (!containerAuthorized(t.uuid, auth)) {
                            throw new C.http.Error(403, "unauthorized", {
                                container: t.uuid,
                                account: auth.account,
                                action: 'delete'
                            })
                        }
                    }

                    containers.push(t)
                })

                return Q.fcall(function() {
                    return Q.all(dataset.map(function(t) {
                        if (t.container_action !== undefined) return

                        if (old_containers.indexOf(t.inventory) > 0) {
                            throw new C.http.Error(422, "invalid_transaction", {
                                reason: "the container is being deleted",
                                container: t.inventory
                            })
                        } else if (new_containers.indexOf(t.inventory) == -1) {
                            return dao.get(t.inventory).then(function(container) {
                                if (!containerAuthorized(container, auth)) {
                                    throw new C.http.Error(403, "unauthorized", {
                                        container: t.inventory,
                                        account: auth.account,
                                        action: 'update'
                                    })
                                }
                            })
                        }
                    }))
                }).then(function() {
                    return Q.all(dataset.map(function(t) {
                        if (t.ship_uuid === undefined)
                            return
                       
                        // TODO use SELECT FOR UPDATE on this when you add transactions
                        return db.query("select * from ships where id = $1", [ t.ship_uuid ]).
                        then(function(data) {
                            var shipRecord = data[0]

                            if (shipRecord === undefined) {
                                throw new C.http.Error(422, "no_such_reference", {
                                    name: "ship_uuid",
                                    ship_uuid: t.ship_uuid
                                })
                            } else if(shipRecord.status !== 'docked') {
                                // TODO validate the current location of the ship
                                // relative to the destination. Also make sure the
                                // user has permissions on the current location of
                                // the ship
                                throw new C.http.Error(409, "invalid_transaction", {
                                    reason: "the ship is not there",
                                    ship_uuid: t.ship_uuid
                                })
                            } else {
                                // This is in leu of SELECT FOR UPDATE atm
                                t.required_status = 'docked'
                                t.current_location = shipRecord.container_id
                                t.current_slice = shipRecord.container_slice
                                t.blueprint = blueprints[shipRecord.doc.blueprint]
                            }
                        })
                    }))
                }).then(function() {
                    dataset.forEach(function(t) {
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

                        if (t.container_action === undefined) {
                            transactions.push(t)
                        }
                    })
                }).then(function() {
                    // validate that the transaction is balanced unless the user is special
                    if (auth.privileged !== true) {
                        var counters = {}

                        var increment = function(type, q) {
                            if (counters[type] === undefined) {
                                counters[type] = 0
                            }

                            counters[type] += q
                        }

                        containers.forEach(function(c) {
                            increment(c.blueprint.uuid, (c.container_action == 'create' ? 1 : -1))
                        })

                        transactions.forEach(function(t) {
                            if (t.ship_uuid === undefined)
                                increment(t.blueprint.uuid, t.quantity)
                        })

                        for (var key in counters) {
                            if (counters[key] !== 0) {
                                throw new C.http.Error(422, "invalid_transaction", {
                                    reason: "unbalanced",
                                    accounting: counters
                                })
                            }
                        }
                    }
                }).then(function() {
                    // TODO this should all be in a database transaction
                    return Q.all(containers.map(function(c) {
                        if (c.container_action == "create") {
                            return buildContainer(c.uuid, auth.account, c.blueprint)
                        } else { // destroy ?
                            return dao.destroy(c.uuid)
                        }
                    }))
                }).then(function() {
                    return self.transaction(transactions)
                }).then(function() {
                    res.sendStatus(204)
                })
            }).fail(C.http.errHandler(req, res, error)).done()
        })
    }
}
