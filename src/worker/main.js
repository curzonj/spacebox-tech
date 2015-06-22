'use strict';

var Q = require('q')
var C = require('spacebox-common')

var config = require('../config')
config.setName('worker')

var solarsystems = require('../solar_systems')
var production_dep = require('../production_dep')
var production = require('../production')
var ctx = config.ctx
var db = config.db
var worldState = config.state

function destroyVessel(ctx, uuid) {
    return db.tx(ctx, function(db) {
        return db.inventory.getForUpdateOrFail(uuid, db).
        then(function(container) {
            return db.any("select * from facilities where inventory_id = $1", uuid)
        }).then(function(list) {
            return Q.all(list.map(function(facility) {
                return production_dep.destroyFacility(facility, db)
            }))
        }).then(function() {
            return db.inventory.destroy(uuid, db)
        }).then(function() {
            return db.none("delete from items where id = $1", uuid)
        })
    })
}

worldState.events.on('worldtick', function(msg, deleted) {
    Object.keys(msg.changes).forEach(function(uuid) {
        var patch = msg.changes[uuid]
        if (patch.tombstone === true && (patch.tombstone_cause === 'destroyed' || patch.tombstone_cause === 'despawned')) {
            var old = deleted[uuid]
            if (old.type == 'vessel')
                destroyVessel(ctx, uuid).done()
        }
    })
})

setInterval(production.build_worker_fn, config.game.job_processing_interval)
setInterval(solarsystems.checkWormholeTTL, 60000)

worldState.subscribe()
solarsystems.ensurePoolSize().done()

/*
    /// This is for the space_object database table
    var keys_to_update_on = ["blueprint", "account", "solar_system"]
        if (keys_to_update_on.some(function(i) {
                return patch.hasOwnProperty(i)
            })) {

            // Ideally these would go out in guaranteed order via a journal
            dao.update(uuid, old).done()
        }
*/
