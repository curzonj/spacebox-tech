'use strict';

var Q = require('q'),
    C = require('spacebox-common'),
    db = require('spacebox-common-native').db,
    dao = require('./dao.js'),
    pubsub = require('./pubsub.js'),
    blueprints = require('./blueprints.js')

// This module exists only to eliminate a circular dependency between prod and inv
// prod -> inv -> prod_dep
var self = module.exports = {
    destroyFacility: function(facility, db) {
        pubsub.publish(db.ctx, {
            type: 'facility',
            account: facility.account,
            tombstone: true,
            uuid: facility.id,
            blueprint: facility.blueprint,
        })

        return db.none("delete from facilities where id=$1", facility.id)
    },
    updateFacilities: function(uuid, db) {
        db.assertTx()

        return Q.spread([
            blueprints.getData(),
            dao.inventory.getForUpdateOrFail(uuid, db),
            db.any("select * from facilities where inventory_id = $1 for update", uuid)
        ], function(blueprints, container, current_facilities) {
            var container_bp = blueprints[container.doc.blueprint]

            if (isNaN(container_bp.capacity) || container_bp.capacity <= 0)
                return

            var new_facility_modules = container.doc.modules.slice().
            concat(container_bp.native_modules || []).
            filter(function(v) {
                    return (blueprints[v].facility_type !== undefined)
                }),
                current_facility_modules =
                current_facilities.map(function(v) {
                    return v.blueprint
                }),
                changes = C.compute_array_changes(current_facility_modules, new_facility_modules)

            db.ctx.log('build', 'updateFacilities', container, current_facilities, changes)

            return Q.all([
                Q.all(changes.added.map(function(v) {
                    return db.none("insert into facilities (id, account, inventory_id, blueprint, facility_type, trigger_at, doc) values (uuid_generate_v1(), $1, $2, $3, $4, current_timestamp, $5)", [container.account, uuid, v, blueprints[v].facility_type, {}])
                })),
                Q.all(C.array_unique(changes.removed).map(function(v) {
                    // If there is still some of the removed facilities
                    // installed, just disabled them and let the use pick
                    if (container.doc.modules.indexOf(v) > -1) {
                        return db.none("update facilities set disabled = true where inventory_id = $1 and blueprint = $2", [uuid, v])
                    } else { // If there are none remaining, just destroy them
                        return db.many("select * from facilities where inventory_id = $1 and blueprint = $2 for update", [uuid, v]).
                        then(function(list) {
                            return Q.all(list.map(function(facility) {
                                return self.destroyFacility(facility, db)
                            }))
                        })
                    }
                })),
                Q.all(C.array_unique(changes.unchanged).map(function(v) {
                    return db.none("update facilities set disabled = false where inventory_id = $1 and blueprint = $2", [uuid, v])
                }))
            ]).then(function() {
                pubsub.publish(db.ctx, {
                    type: 'facilities',
                    account: container.account,
                    inventory: uuid,
                    changes: changes
                })
            })
        })
    }
}
