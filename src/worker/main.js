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
var worldState = config.state

worldState.events.on('worldtick', function(msg, deleted) {
    Object.keys(msg.changes).forEach(function(uuid) {
        var patch = msg.changes[uuid]
        if (patch.tombstone === true && (patch.tombstone_cause === 'destroyed' || patch.tombstone_cause === 'despawned')) {
            var old = deleted[uuid]
            if (old.type == 'vessel')
                inventory.destroyVessel(db, ctx, uuid).
                fail(function(e) {
                    ctx.fatal({ err: e, uuid: uuid, patch: patch }, 'failed to reap a tombstone')
                })
        }
    })
})

setInterval(production.build_worker_fn, config.game.job_processing_interval)
setInterval(solarsystems.checkWormholeTTL, 60000)

worldState.subscribe()
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
