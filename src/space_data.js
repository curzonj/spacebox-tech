'use strict';

var Q = require('q')
var C = require('spacebox-common')
var uuidGen = require('node-uuid')
var th = require('spacebox-common/src/three_helpers.js')

var config = require('./config')
var worldState = config.state
var db = config.db

var self = module.exports = {
    random_position: function(l, o) {
        if (o === undefined)
            o = {
                x: 0,
                y: 0,
                z: 0
            }

        function rand() {
            var base = Math.floor((Math.random() - 0.5) * 2 * (l.max - l.min))
            if (base > 0) {
                return base + l.min
            } else {
                return base - l.min
            }
        }

        return {
            x: o.x + rand(),
            y: o.y + rand(),
            z: o.z + rand()
        }
    },
    addObject: function(values) {
        values.uuid = values.uuid || uuidGen.v1()

        var uuid = values.uuid

        values.chunk = th.buildVectorBucket(values.position, config.game.chunk_size)

        //debug("added object", uuid, values)
        return worldState.queueChangeIn(uuid, values).then(function() {
            return uuid
        })
    },
    spawn: C.logging.trace('space_data.spawn', 
        function(ctx, uuid, blueprint, msg, fn) {
            if (blueprint === undefined ||
                msg.solar_system === undefined ||
                msg.agent_id === undefined) {
                throw new Error("invalid spawn params")
            }

            var obj = {
                type: blueprint.type,
                solar_system: msg.solar_system,
                agent_id: msg.agent_id,
                blueprint: blueprint.uuid,
                health: blueprint.maxHealth,
                model_name: blueprint.model_name,
                effects: {},
                systems: {},
                position: msg.position || {
                    x: 0,
                    y: 0,
                    z: 0
                },
                velocity: {
                    x: 0,
                    y: 0,
                    z: 0
                },
                facing: {
                    x: 0,
                    y: 0,
                    z: 0,
                    w: 1
                },
            }

            // If we did it above the blueprint merge
            // would over write it
            obj.uuid = uuid

            if (blueprint.thrust !== undefined) {
                // TODO this should obviously be calculated
                obj.systems.engine = {
                    state: null,
                    "maxVelocity": 1.0,
                    "maxTheta": Math.PI / 10,
                    "maxThrust": 0.1
                }
            }

            return Q.fcall(function() {
                if (Array.isArray(msg.modules))
                    return Q.all(msg.modules.map(function(uuid) {
                        return db.blueprints.get(uuid).then(function(bp) {
                            var fn = self['build_' + bp.tech_type + '_system']

                            if (typeof fn === 'function')
                                obj.systems[bp.tech_type] = fn(obj.systems[bp.tech_type], bp)
                        })
                    }))
            }).then(function() {
                ctx.old_debug('3dsim', obj)
                return self.addObject(obj).then(function(uuid) {
                    //ctx.old_log('3dsim', "built space object", { blueprint: blueprint, id: uuid })

                    return uuid
                })

            })
        }),
    build_weapon_system: function(prev, bp) {
        return C.deepMerge(bp, {
            state: null
        })
    }
}
