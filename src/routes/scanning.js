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

        return worldState.getP(msg.vessel).
        then(function(ship) {
            if (ship === null)
                throw new Error("invalid vessel")

            return ship.solar_system
        }).then(function(systemId) {
            return async.map(
            solarsystems.getWormholes(systemId, req.ctx).
            tap(function(data) {
                req.ctx.trace({ wormholes: data, solar_system: systemId }, 'wormholes in the system')
            }),
            function(row) {
                var spo_doc, destination, direction;

                if (row.outbound_system === systemId) {
                    direction = 'outbound'
                    spo_doc = row.outbound_doc
                    destination = row.inbound_system
                } else {
                    direction = 'inbound'
                    spo_doc = row.inbound_doc
                    destination = row.outbound_system
                }

                if (spo_doc === null) {
                    return req.db.tx(function(db) {

                        // Open a transaction and lock the wormhole before trying to spawn the other
                        // end so we don't get race conditions of two ships trying to scan the same
                        // system at the same time
                        return db.one("select * from wormholes where id = $1 for update", row.id).
                        then(function(row) {
                            if (!row[direction+"_doc"]) {
                                spo_doc = {
                                    position: space_data.random_position(config.game.wormhole_range),
                                    solar_system: systemId
                                }

                                return space_data.addObject({
                                    type: 'wormhole',
                                    position: spo_doc.position,
                                    solar_system: systemId,
                                    wormhole: {
                                        destination: destination,
                                        expires_at: row.expires_at
                                    }
                                }).tap(function(spo_id) {
                                    spo_doc.uuid = spo_id
                                    return db.none("update wormholes set " + direction + "_doc = $2 where id = $1", [row.id, spo_doc])
                                }).then(function() {
                                    return spo_doc
                                })
                            } else {
                                return row[direction+'_doc']
                            }
                        })
                    })
                } else {
                    return spo_doc
                }
            }).then(function(list) {
                list.forEach(function(obj) {
                    delete obj.solar_system // it's not needed here
                })

                return list
            })
        }).then(function(data) {
            res.send({
                result: data
            })
        }).fail(next).done()
    })

    app.post('/commands/jumpWormhole', function(req, res, next) {
        var msg = req.body

        return req.db.oneOrNone("select * from wormholes where inbound_doc::json->>'uuid' = $1 or outbound_doc::json->>'uuid' = $1 and expires_at > current_timestamp", msg.wormhole).
        then(function(row) {
            if (!row)
                throw new Error("that wormhole has collapsed or does not exist")

            req.ctx.debug({ wormhole: row }, 'wormhole record')

            return Q.all([ row, worldState.getP(msg.vessel) ])
        }).spread(function(wormhole, ship) {
            var systemId = ship.solar_system
            var wh_doc = wormhole.outbound_doc

            // This is the doc of the wormhole we are jumping through
            if (wormhole.inbound_doc && wormhole.inbound_doc.uuid === msg.wormhole)
                wh_doc = wormhole.inbound_doc

            if (!ship) {
                throw new Error("no such ship")
            } else if (wh_doc.solar_system !== systemId) {
                throw new Error("requested wormhole is in the wrong system")
            } else if (ship.systems.indexOf('engine') === -1) {
                req.ctx.warn({ ship: ship }, 'engine request on structure')
                throw new Error("that vessel can't move")
            }

            th.buildVector(position1, ship.position)
            th.buildVector(position2, wh_doc.position)

            //console.log(system.range, position1.distanceTo(position2), position1, position2)

            var current_range = position1.distanceTo(position2)
            if (current_range > config.game.wormhole_jump_range)
                throw new C.http.Error(400, "You are not within range", {
                    required: config.game.wormhole_jump_range,
                    current: current_range
                })

            return wormhole
        }).then(function(row) {
            var side = 'outbound'

            // if we jump through the outbound WH we arrive at the inbound WH
            if (row.outbound_doc && row.outbound_doc.uuid === msg.wormhole)
                side = 'inbound'

            var wh_doc = row[side+'_doc']

            return Q.fcall(function() {
                if (wh_doc === null) {
                    // this only happens on the inbound side of wormholes
                    if (side !== 'inbound') {
                        req.ctx.error({ wormhole: row }, 'this wormhole is broken, the outbound doc is null')
                        throw new Error('this wormhole is broken, the outbound doc is null')
                    }

                    wh_doc = {
                        position: space_data.random_position(config.game.wormhole_range),
                        solar_system: row.inbound_system
                    }

                    return space_data.addObject({
                        type: 'wormhole',
                        position: wh_doc.position,
                        solar_system: row.inbound_system,
                        wormhole: {
                            destination: row.outbound_system,
                            expires_at: row.expires_at
                        }
                    }).then(function(spo_id) {
                        wh_doc.uuid = spo_id

                        req.ctx.debug({ row_id: row.id, spo_id: spo_id}, 'created wormhole to jump to')
                        return req.db.query("update wormholes set inbound_doc = $2 where id = $1", [row.id, wh_doc])
                    })
                }
            }).then(function() {
                // When you jump through the wormhole you're not moving
                // when you get there
                return worldState.queueChangeIn(msg.vessel, {
                    solar_system: wh_doc.solar_system,
                    position: wh_doc.position,
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
        }).then(function() {
            res.send({
                result: true
            })
        }).fail(next).done()
    })
}
