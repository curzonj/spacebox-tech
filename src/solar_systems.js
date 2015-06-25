'use strict';

var Q = require('q')
var C = require('spacebox-common')
var util = require('util')
var async = require('async-q')

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
    populateWormholes: function(id, ctx) {
        // The generator function SQL will make sure
        // we only create the correct number of wormholes
        return db.tx(function(db) {
            return db.query("LOCK TABLE wormholes IN SHARE ROW EXCLUSIVE MODE").
            then(function() {
                return async.timesSeries(
                    config.game.minimum_count_wormholes,
                    db.wormholes.randomGeneratorFn(id)
                )
            })
        })
    },
    getWormholes: function(systemid, ctx) {
        ctx.debug({ system_id: systemid }, 'searching for current wormholes')

        return db.one("select * from system_wormholes where id = $1", systemid).
        then(function(result) {
            if (result.count < config.game.minimum_count_wormholes)
                return self.populateWormholes(systemid, ctx)
        }).then(function() {
            return db.many("select * from wormholes where (inbound_system = $1 or outbound_system = $1) and expires_at > current_timestamp ", systemid)
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
        var ctx = config.ctx
        ctx.debug("checking expired wormholes")

        db.query("select * from wormholes where expires_at < current_timestamp").
        then(function(data) {
            return async.map(data, function(row) {
                ctx.trace({ wormhole: row }, 'wormhole for cleanup')

                return async.map([row.inbound_id, row.outbound_id], function(key) {
                    if (key === null)
                        return

                    var obj = worldState.get(key)
                    if (obj === undefined)
                        return

                    return worldState.queueChangeIn(obj.uuid, {
                        tombstone: true
                    }).then(function() {
                        return db.query("delete from wormholes where id = $1", row.id)
                    })
                })
            })
        }).done()
    }
}

module.exports = self
