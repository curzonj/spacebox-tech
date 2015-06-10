'use strict';

var util = require('util'),
    npm_debug = require('debug'),
    log = npm_debug('3dsim:info'),
    error = npm_debug('3dsim:error'),
    debug = npm_debug('3dsim:debug'),
    C = require('spacebox-common'),
    Q = require('q'),
    config = require('./config.js'),
    worldState = require('./redisWorldState.js'),
    db = require('spacebox-common-native').db

var dao = {
    systems: {
        insert: function(id, doc) {
            return db.
            query("insert into solar_systems (id, doc) values ($1, $2)", [id, doc])
        }
    },
    wormholes: {
        randomGeneratorFn: function(system_id) {
            return function() {
                return db.query("with available_systems as (select * from system_wormholes where count < $3 and id != $1 and id not in (select inbound_system from wormholes where outbound_system = $1)) insert into wormholes (id, expires_at, outbound_system, inbound_system) select uuid_generate_v1(), current_timestamp + interval $4, $1, (select id from available_systems offset floor(random()*(select count(*) from available_systems)) limit 1) where not exists (select id from system_wormholes where id = $1 and count >= $2) returning id", [system_id, config.game.minimum_count_wormholes, config.game.maximum_count_wormholes, config.game.wormhole_lifetime])
            }
        }
    }
}

var self = {
    getSpawnSystemId: function() {
        return db.one("select id from solar_systems offset floor(random()*(select count(*) from solar_systems)) limit 1").
        then(function(data) {
            return data.id
        })
    },
    createSystem: function() {
        var doc = {}

        return db.
        query("insert into solar_systems (id, doc) values (uuid_generate_v1(), $1) returning id", [doc]).
        then(function(data) {
            return data[0].id
        })
    },
    populateWormholes: function(data) {
        debug(data)

        return Q.all(data.map(function(row) {
            var q = Q(null),
                fn = dao.wormholes.randomGeneratorFn(row.id)

            // The generator function SQL will make sure
            // we only create the correct number of wormholes
            for (var i = 0; i < config.game.minimum_count_wormholes; i++) {
                q = q.then(fn);
            }

            return q
        }))
    },
    getWormholes: function(systemid) {
        debug(systemid)

        return db.query("select * from system_wormholes where id = $1", [systemid]).
        then(self.populateWormholes).
        then(function() {
            return db.query("select * from wormholes where (inbound_system = $1 or outbound_system = $1) and expires_at > current_timestamp ", [systemid])
        })
    },
    ensurePoolSize: function() {
        return db.query("select count(*)::int from solar_systems").
        then(function(data) {
            for (var i = data[0].count; i < config.game.minumim_solar_systems; i++) {
                self.createSystem().done()
            }
        })
    },
    whenIsReady: function() {
        return self.ensurePoolSize()
    },
    checkWormholeTTL: function() {
        debug("checking expired wormholes")

        db.query("select * from wormholes where expires_at < current_timestamp").
        then(function(data) {
            return Q.all(data.map(function(row) {
                console.log('wormhole for cleanup', row)
                return [row.inbound_id, row.outbound_id].map(function(key) {
                    if (key === null)
                        return

                    var obj = worldState.get(key)
                    if (obj === undefined)
                        return

                    worldState.queueChangeIn(obj.uuid, {
                        tombstone: true
                    })

                    console.log("cleaning up wormhole", row.id)
                    return db.query("delete from wormholes where id = $1", [row.id])
                })
            }))
        }).done()
    }
}

module.exports = self
