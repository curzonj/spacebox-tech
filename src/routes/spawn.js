'use strict';

var Q = require('q')
var C = require('spacebox-common')
var uuidGen = require('node-uuid')
var THREE = require('three')
var th = require('spacebox-common/src/three_helpers')

var config = require('../config')
var db = config.db
var worldState = config.state
var solarsystems = require('../solar_systems')
var space_data = require('../space_data')
var inventory = require('../inventory')

function spawnVessel(ctx, msg) {
    return Q.fcall(function() {
        if (msg.uuid !== undefined) {
            return worldState.getP(msg.uuid).
            then(function(target) {
                if (target) {
                    ctx.warn({ requested: msg, existing: target }, 'uuid collision')
                    throw new Error("uuid collision")
                }
            })
        }
    }).then(function() {
        return db.blueprints.get(msg.blueprint)
    }).then(function(blueprint) {
        var agent_id,
            target,
            uuid = msg.uuid || uuidGen.v1()

        if (blueprint === undefined ||
            msg.solar_system === undefined ||
            msg.agent_id === undefined) {
            throw new Error("invalid spawn params")
        }

        return inventory.spawnVessel(ctx, {
            uuid: uuid,
            agent_id: msg.agent_id,
            blueprint: blueprint.uuid,
            from: msg.from || {
                uuid: null,
                slice: null
            },
            modules: msg.modules
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
    app.post('/commands/dock', function(req, res, next) {
        var msg = req.body

        Q.spread([
            worldState.getP(msg.vessel_uuid),
            worldState.getP(msg.container),
        ], function(vessel, container) {
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
                agent_id: req.auth.agent_id,
                container_id: msg.container,
                slice: msg.slice
            }).then(function() {
                return worldState.queueChangeIn(vessel.uuid, {
                    tombstone_cause: 'docking',
                    tombstone: true
                })
            }).then(function(data) {
                res.json({
                    result: data
                })
            })
        }).fail(next).done()
    })

    app.post('/commands/deploy', function(req, res, next) {
        var msg = req.body

        if (!msg.slice)
            msg.slice = 'default'

        Q.fcall(function() {
            if (!req.auth.priviliged)
                return db.one(
                    "select count(*) as count from items where agent_id = $1",
                    req.auth.agent_id).
                then(function(result) {
                    if (result.count >= config.game.maximum_vessels)
                        throw new Error("already have the maximum number of deployed vessels")
                })

        }).then(function() {
            return worldState.getP(msg.container_id).
            tap(function(container) {
                req.ctx.trace({ container: container }, 'deploy from')
                if (container === null)
                    throw new Error("failed to find the container. container_id=" + msg.container_id) // TODO 404
            })
        }).then(function(container) {
            return spawnVessel(req.ctx, {
                uuid: msg.vessel_uuid, // uuid may be undefined here, spawnVessel will populate it if need be
                blueprint: msg.blueprint,
                agent_id: req.auth.agent_id,
                position: container.position,
                solar_system: container.solar_system,
                from: {
                    uuid: msg.container_id,
                    slice: msg.slice
                }
            })
        }).then(function(data) {
            res.json({
                result: data
            })
        }).fail(next).done()
    })

    app.post('/commands/spawn', function(req, res, next) {
        if (req.auth.privileged !== true)
            throw new Error("restricted to npc agents")

        return spawnVessel(req.ctx, req.body).then(function(data) {
            res.json({
                result: data
            })
        }).fail(next).done()
    })

    app.post('/commands/spawnStarter', function(req, res, next) {
        var uuid = uuidGen.v1()

        return inventory.getStarterData(req.ctx, uuid, req.auth.agent_id).
        then(function(data) {
            return Q.all([
                solarsystems.getSpawnSystemId(),
                db.blueprints.get(data.blueprint_id),
                data
            ])
        }).spread(function(solar_system, blueprint, data) {
            return space_data.spawn(req.ctx, uuid, blueprint, {
                modules: data.modules,
                agent_id: req.auth.agent_id,
                position: space_data.random_position(config.game.spawn_range),
                solar_system: solar_system
            })
        }).then(function(data) {
            res.json({
                result: data
            })
        }).fail(next).done()
    })
}
