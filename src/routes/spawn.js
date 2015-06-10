'use strict';

var Q = require('q'),
    THREE = require('three'),
    uuidGen = require('node-uuid'),
    db = require('spacebox-common-native').db,
    C = require('spacebox-common')

var worldState = require('../redisWorldState'),
    solarsystems = require('../solar_systems'),
    th = require('spacebox-common/src/three_helpers'),
    config = require('../config'),
    space_data = require('../space_data'),
    dao = require('../dao'),
    inventory = require('../inventory')

function spawnVessel(ctx, msg) {
    return Q.fcall(function() {
        if (msg.uuid !== undefined) {
            return worldState.get(msg.uuid).
            then(function(target) {
                if (target !== null)
                    throw new Error("uuid collision")
            })
        }
    }).then(function() {
        return dao.blueprints.get(msg.blueprint)
    }).then(function(blueprint) {
        var account,
            target,
            next = Q(null),
            uuid = msg.uuid || uuidGen.v1()

        if (blueprint === undefined ||
            msg.solar_system === undefined ||
            msg.account === undefined) {
            throw new Error("invalid spawn params")
        }

        return next.then(function() {
            return inventory.spawnVessel(ctx, {
                uuid: uuid,
                account: msg.account,
                blueprint: blueprint.uuid,
                from: msg.from || {
                    uuid: null,
                    slice: null
                },
                modules: msg.modules
            })
        }).then(function(data) {
            msg.modules = data.modules
            return space_data.spawn(ctx, uuid, blueprint, msg)
        })
    })
}


module.exports = function(app) {
    // NodeJS is single threaded so this is instead of object pooling
    var position1 = new THREE.Vector3()
    var position2 = new THREE.Vector3()
    app.post('/commands/dock', function(req, res) {
        var msg = req.body

        Q.spread([
            C.http.authorize_req(req),
            worldState.get(msg.vessel_uuid),
            worldState.get(msg.container),
        ], function(auth, vessel, container) {
            if (vessel === undefined || vessel.tombstone === true) {
                throw new Error("no such vessel")
            } else if (container === undefined || container.tombstone === true) {
                throw new Error("no such container")
            }

            th.buildVector(position1, vessel.position)
            th.buildVector(position2, container.position)

            if (position1.distanceTo(position2) > config.game.docking_range)
                throw ("You are not within range, " + config.game.docking_range)

            return inventory.dockVessel(req.ctx, msg.vessel_uuid, {
                account: auth.account,
                inventory: msg.container,
                slice: msg.slice
            }).then(function() {
                return worldState.queueChangeIn(vessel.uuid, {
                    tombstone_cause: 'docking',
                    tombstone: true
                })
            }).then(function(data) {
                res.send({
                    result: data
                })
            })
        }).fail(C.http.errHandler(req, res, console.log)).done()
    })

    app.post('/commands/deploy', function(req, res) {
        var msg = req.body
        Q.spread([C.http.authorize_req(req), worldState.get(msg.container_id)],
        function(auth, container) {
            console.log('/commands/deploy', msg, container)

            /*
            var num_vessels = Object.keys(h.visibility.privilegedKeys).length
            if (num_vessels >= config.game.maximum_vessels)
                throw new Error("already have the maximum number of deployed vessels")
                */

            if (container === undefined)
                throw new Error("failed to find the container to launch the vessel. container_id=" + msg.container_id)

            if (msg.slice === undefined || msg.blueprint === undefined)
                throw new Error("missing parameters: slice or blueprint")

            msg.account = auth.account

            return spawnVessel(req.ctx, {
                uuid: msg.vessel_uuid, // uuid may be undefined here, spawnVessel will populate it if need be
                blueprint: msg.blueprint,
                account: auth.account,
                position: C.deepMerge(container.position, {}),
                solar_system: container.solar_system,
                from: {
                    uuid: msg.container_id,
                    slice: msg.slice
                }
            }).then(function(data) {
                res.send({
                    result: data
                })
            })
        }).fail(C.http.errHandler(req, res, console.log)).done()
    })

    app.post('/commands/spawn', function(req, res) {
        C.http.authorize_req(req, true).then(function(auth) {
            return spawnVessel(req.ctx, req.body).then(function(data) {
                res.send({
                    result: data
                })
            })
        }).fail(C.http.errHandler(req, res, console.log)).done()
    })

    app.post('/commands/spawnStarter', function(req, res) {
        C.http.authorize_req(req).then(function(auth) {
            var uuid = uuidGen.v1()

            return C.request('api', 'POST', 200, '/getting_started', {
                uuid: uuid,
                account: auth.account
            }, req.ctx).then(function(data) {
                console.log('getting_started', data)
                return Q.all([
                    solarsystems.getSpawnSystemId(),
                    dao.blueprints.get(data.blueprint_id),
                    data
                ])
            }).spread(function(solar_system, blueprint, data) {
                return space_data.spawn(req.ctx, uuid, blueprint, {
                    modules: data.modules,
                    account: auth.account,
                    position: space_data.random_position(config.game.spawn_range),
                    solar_system: solar_system
                })
            }).then(function(data) {
                res.send({
                    result: data
                })
            })
        }).fail(C.http.errHandler(req, res, console.log)).done()
    })
}
