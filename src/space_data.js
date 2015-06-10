'use strict';

var Q = require('q'),
    C = require('spacebox-common')

var worldState = require('./redisWorldState'),
    dao = require('./dao'),
    config = require('./config')

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
    spawn: function(ctx, uuid, blueprint, msg, fn) {
        //ctx.log('3dsim', 'space_data.spawn', msg)

        if (blueprint === undefined ||
            msg.solar_system === undefined ||
            msg.account === undefined) {
            throw new Error("invalid spawn params")
        }

        var obj = C.deepMerge(blueprint, {
            solar_system: msg.solar_system,
            account: msg.account,
            blueprint: blueprint.uuid,
            health: blueprint.maxHealth,
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
        })

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
                    return dao.blueprints.get(uuid).then(function(bp) {
                        var fn = self['build_' + bp.tech_type + '_system']

                        if (typeof fn === 'function')
                            obj.systems[bp.tech_type] = fn(obj.systems[bp.tech_type], bp)
                    })
                }))
        }).then(function() {
            ctx.debug('3dsim', obj)
            return worldState.addObject(obj).then(function(uuid) {
                //ctx.log('3dsim', "built space object", { blueprint: blueprint, id: uuid })

                return uuid
            })

        })
    },
    build_weapon_system: function(prev, bp) {
        return C.deepMerge(bp, {
            state: null
        })
    }
}
