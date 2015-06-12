'use strict';

var Q = require('q'),
    THREE = require('three'),
    uuidGen = require('node-uuid'),
    db = require('spacebox-common-native').db,
    C = require('spacebox-common')

var worldState = require('spacebox-common-native/lib/redis-state'),
    space_data = require('../space_data.js'),
    config = require('../config.js'),
    th = require('spacebox-common/src/three_helpers.js'),
    solarsystems = require('../solar_systems.js')

// NodeJS is single threaded so this is instead of object pooling
var position1 = new THREE.Vector3()
var position2 = new THREE.Vector3()

module.exports = function(app) {
    app.post('/commands/scanWormholes', function(req, res) {
        var msg = req.body
        var shipId = msg.vessel

        Q.spread([C.http.authorize_req(req), worldState.get(msg.vessel)],
        function(auth, ship) {
            if (ship === undefined)
                throw "invalid vessel"

            var systemId = ship.solar_system

            return solarsystems.getWormholes(systemId, req.ctx).then(function(data) {
                req.ctx.trace({ wormholes: data }, 'wormholes in the system')

                return Q.all(data.map(function(row) {
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
                        return space_data.addObject({
                            type: 'wormhole',
                            position: space_data.random_position(config.game.wormhole_range),
                            solar_system: systemId,
                            wormhole_id: row.id,
                            destination: destination,
                            direction: direction,
                            expires_at: row.expires_at
                        }).tap(function(spo_id) {
                            return db.query("update wormholes set " + direction + "_id = $2 where id = $1", [row.id, spo_id])
                        })
                    } else {
                        return spodb_id
                    }
                }))
            }).then(function(data) {
                res.send({
                    result: data
                })
            })
        }).fail(C.http.errHandler(req, res, console.log)).done()
    })

    app.post('/commands/jumpWormhole', function(req, res) {
        var msg = req.body

        Q.spread([
            C.http.authorize_req(req),
            worldState.get(msg.vessel),
            worldState.get(msg.wormhole),
        ], function(auth, ship, wormhole) {
            var systemId = ship.solar_system
            if (wormhole.solar_system !== systemId) {
                throw ("requested wormhole is in the wrong system")
            } else if (wormhole.type !== 'wormhole') {
                throw ("that's not a wormhole")
            } else if (wormhole.tombstone === true) {
                throw ("that wormhole has collapsed")
            } else if (ship.systems.engine === undefined) {
                throw ("that vessel can't move")
            }

            th.buildVector(position1, ship.position)
            th.buildVector(position2, wormhole.position)

            //console.log(system.range, position1.distanceTo(position2), position1, position2)

            if (position1.distanceTo(position2) > config.game.wormhole_jump_range)
                throw ("You are not within range, " + config.game.wormhole_jump_range)

            req.ctx.debug({ wormhole: wormhole }, 'wormhole object for jump')

            return db.query("select * from wormholes where id = $1 and expires_at > current_timestamp", wormhole.wormhole_id).
            then(function(data) {
                if (data.length === 0)
                    throw ("that wormhole has collapsed")

                req.ctx.debug({ wormhole: data }, 'wormhole record')
                var destination_id, row = data[0],
                    direction = wormhole.direction,
                    before = Q(null)

                if (direction === 'outbound' && row.inbound_id === null) {
                    // this only happens on WHs outbound from this system
                    before = space_data.addObject({
                        type: 'wormhole',
                        position: space_data.random_position(config.game.wormhole_range),
                        solar_system: row.inbound_system,
                        wormhole_id: row.id,
                        destination: systemId,
                        direction: 'inbound',
                        expires_at: row.expires_at
                    }).then(function(spo_id) {
                        req.ctx.debug({ row_id: row.id, spo_id: spo_id}, 'created wormhole to jump to')
                        destination_id = spo_id

                        return db.query("update wormholes set inbound_id = $2 where id = $1", [row.id, spo_id])
                    })
                } else {
                    destination_id = row.outbound_id
                }

                return before.then(function() {
                    return worldState.get(destination_id)
                }).then(function(destination_spo) {
                    // When you jump through the wormhole you're not moving
                    // when you get there
                    return worldState.queueChangeIn(msg.vessel, {
                        solar_system: destination_spo.solar_system,
                        position: destination_spo.position,
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
            })
        }).fail(C.http.errHandler(req, res, console.log)).done()
    })




}
