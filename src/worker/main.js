'use strict';

var C = require('spacebox-common')
C.logging.configure('worker')

require('../db_config')

var Q = require('q')
var db = require('spacebox-common-native').db

var solarsystems = require('../solar_systems.js')
var worldState = require('spacebox-common-native/src/redis-state')
var production = require('../production_dep.js')

function destroyVessel(ctx, uuid) {
    return db.tx(ctx, function(db) {
        return db.inventory.getForUpdateOrFail(uuid, db).
        then(function(container) {
            return db.any("select * from facilities where inventory_id = $1", uuid)
        }).then(function(list) {
            return Q.all(list.map(function(facility) {
                return production.destroyFacility(facility, db)
            }))
        }).then(function() {
            return db.inventory.destroy(uuid, db)
        }).then(function() {
            return db.none("delete from items where id = $1", uuid)
        })
    })
}

worldState.events.on('worldtick', function(msg, deleted) {
    var ctx = C.logging.defaultCtx()

    Object.keys(msg.changes).forEach(function(uuid) {
        var patch = msg.changes[uuid]
        if (patch.tombstone === true && (patch.tombstone_cause === 'destroyed' || patch.tombstone_cause === 'despawned')) {
            var old = deleted[uuid]
            if (old.type == 'vessel')
                destroyVessel(ctx, uuid).done()
        }
    })
})

setInterval(function() {
    var ctx = C.logging.defaultCtx()
    solarsystems.checkWormholeTTL(ctx)
}, 60000)

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
