'use strict';

var Q = require('q')
var C = require('spacebox-common')
var uuidGen = require('node-uuid')
var THREE = require('three')
var th = require('spacebox-common/src/three_helpers')
var async = require('async-q')

var config = require('../config')
var worldState = config.state
var space_data = require('../space_data')
var solarsystems = require('../solar_systems')

// NodeJS is single threaded so this is instead of object pooling
var position1 = new THREE.Vector3()
var position2 = new THREE.Vector3()

module.exports = function(app) {
    app.post('/commands/scanWormholes', function(req, res, next) {
        var msg = req.body
        var ship = worldState.get(msg.vessel)

        if (ship === undefined)
            throw new Error("invalid vessel")

        var systemId = ship.solar_system

        return solarsystems.getWormholes(systemId, req.ctx).then(function(data) {
            req.ctx.trace({ wormholes: data }, 'wormholes in the system')

            return async.map(data, function(row) {
                var spodb_id, destination, direction;

                if (row.outbound_system === systemId) {
                    direction = 'outbound'
                    spodb_id = row.inbound_id
                    destination = row.inbound_system
                } else {
                    direction = 'inbound'
                    spodb_id = row.inbound_id
                    destination = row.outbound_system
                }

                if (spodb_id === null) {
                    return req.db.tx(function(db) {
                        // Open a transaction and lock the wormhole before trying to spawn the other
                        // end so we don't get race conditions of two ships trying to scan the same
                        // system at the same time
                        return db.one("select * from wormholes where id = $1 for update", row.id).
                        then(function(row) {
                            if (!row[direction+"_id"]) {
                                var position = space_data.random_position(config.game.wormhole_range)
                                return space_data.addObject({
                                    type: 'wormhole',
                                    position: position,
                                    solar_system: systemId,
                                    wormhole: {
                                        id: row.id,
                                        destination: destination,
                                        direction: direction,
                                        expires_at: row.expires_at
                                    }
                                }).tap(function(spo_id) {
                                    return db.query("update wormholes set " + direction + "_id = $2 where id = $1", [row.id, spo_id])
                                }).then(function(spo_id) {
                                    return {
                                        uuid: spo_id,
                                        position: position
                                    }
                                })
                            } else {
                                // someone else scanned and generated a position for this wormhole
                                return worldState.wait_for_world(function(obj) {
                                    return (obj.type === 'wormhole' &&
                                            obj.wormhole.id === row.id)
                                }).then(function(obj) {
                                    return {
                                        uuid: spodb_id,
                                        position: obj.position
                                    }
                                })
                            }
                        })
                    })
                } else {
                    return worldState.wait_for_world_fn(function(data) {
                        // If it's undefined it won't match
                        return data[spodb_id]
                    }).then(function(obj) {
                        return {
                            uuid: spodb_id,
                            position: obj.position
                        }
                    })
                }
            })
        }).then(function(data) {
            res.send({
                result: data
            })
        }).fail(next).done()
    })

    app.post('/commands/jumpWormhole', function(req, res, next) {
        var msg = req.body
        var ship = worldState.get(msg.vessel)
        var wormhole = worldState.get(msg.wormhole)
        var systemId = ship.solar_system

        if (!ship || !wormhole) {
            throw new Error("something is missing")
        } else if (wormhole.solar_system !== systemId) {
            throw new Error("requested wormhole is in the wrong system")
        } else if (wormhole.type !== 'wormhole') {
            throw new Error("that's not a wormhole")
        } else if (wormhole.tombstone === true) {
            throw new Error("that wormhole has collapsed")
        } else if (ship.systems.engine === undefined) {
            throw new Error("that vessel can't move")
        }

        th.buildVector(position1, ship.position)
        th.buildVector(position2, wormhole.position)

        //console.log(system.range, position1.distanceTo(position2), position1, position2)

        var current_range = position1.distanceTo(position2)
        if (current_range > config.game.wormhole_jump_range)
            throw new C.http.Error(400, "You are not within range", {
                required: config.game.wormhole_jump_range,
                current: current_range
            })

        req.ctx.debug({ wormhole: wormhole }, 'wormhole object for jump')

        return req.db.oneOrNone("select * from wormholes where id = $1 and expires_at > current_timestamp", wormhole.wormhole.id).
        then(function(row) {
            if (!row)
                throw new Error("that wormhole has collapsed")

            req.ctx.debug({ wormhole: row }, 'wormhole record')

            var direction = wormhole.wormhole.direction

            return Q.fcall(function() {
                if (direction === 'outbound' && row.inbound_id === null) {
                    // this only happens on WHs outbound from this system
                    var position = space_data.random_position(config.game.wormhole_range)
                    return space_data.addObject({
                        type: 'wormhole',
                        position: position,
                        solar_system: row.inbound_system,
                        wormhole_id: row.id,
                        destination: systemId,
                        direction: 'inbound',
                        expires_at: row.expires_at
                    }).then(function(spo_id) {
                        req.ctx.debug({ row_id: row.id, spo_id: spo_id}, 'created wormhole to jump to')
                        return req.db.query("update wormholes set inbound_id = $2 where id = $1", [row.id, spo_id])
                    }).then(function() {
                        return {
                            solar_system: row.inbound_system,
                            position: position,
                        }
                    })
                } else {
                    return worldState.wait_for_world_fn(function(data) {
                        // If it's undefined it won't match
                        return data[row.outbound_id]
                    }).then(function(result) {
                        return {
                            solar_system: result.solar_system,
                            position: result.position,
                        }
                    })
                }
            }).then(function(result) {
                // When you jump through the wormhole you're not moving
                // when you get there
                return worldState.queueChangeIn(msg.vessel, {
                    solar_system: result.solar_system,
                    position: result.position,
                    velocity: {
                        x: 0,
                        y: 0,
                        z: 0
                    },
                    systems: {
                        engine: {
                            state: null,
                            lookAt: null,
                            theta: 0,
                            acceleration: 0
                        }
                    }
                })
            })
        }).then(function(data) {
            res.send({
                result: data
            })
        }).fail(next).done()
    })
}
