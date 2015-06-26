'use strict';

var Q = require('q')
var C = require('spacebox-common')

var config = require('../config')
config.setName('worker')

var solarsystems = require('../solar_systems')
var production = require('../production')
var inventory = require('../inventory')
var ctx = config.ctx
var db = config.db

;(function () {
    var redis = require('spacebox-common-native').buildRedis(ctx)

    function blpopLoop() {
        redis.blpop('destroyed', 0).
        then(function(result) {
            var uuid = result[1].toString()
            return inventory.destroyVessel(db, ctx, uuid)
        }).fail(function(e) {
            ctx.error({ err: e })
        }).fin(function() {
            blpopLoop()
        }).done()
    }

    blpopLoop()
})()

setInterval(production.build_worker_fn, config.game.job_processing_interval)
setInterval(solarsystems.checkWormholeTTL, 60000)

solarsystems.ensurePoolSize().done()

/*
    /// This is for the space_object database table
    var keys_to_update_on = ["blueprint", "agent_id", "solar_system"]
        if (keys_to_update_on.some(function(i) {
                return patch.hasOwnProperty(i)
            })) {

            // Ideally these would go out in guaranteed order via a journal
            dao.update(uuid, old).done()
        }
*/
