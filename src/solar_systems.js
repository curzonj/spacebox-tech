'use strict';

var Q = require('q')
var C = require('spacebox-common')
var util = require('util')

var config = require('./config')
var worldState = config.state
var db = config.db

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
    populateWormholes: function(data, ctx) {
        ctx.debug({ wormholes: data }, 'wormholes in system')

        return Q.all(data.map(function(row) {
            var q = Q(null),
                fn = db.wormholes.randomGeneratorFn(row.id)

            // The generator function SQL will make sure
            // we only create the correct number of wormholes
            for (var i = 0; i < config.game.minimum_count_wormholes; i++) {
                q = q.then(fn);
            }

            return q
        }))
    },
    getWormholes: function(systemid, ctx) {
        ctx.debug({ system_id: systemid }, 'searching for current wormholes')

        return db.query("select * from system_wormholes where id = $1", [systemid]).
        then(self.populateWormholes, ctx).
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
    checkWormholeTTL: function(ctx) {
        ctx.debug("checking expired wormholes")

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
