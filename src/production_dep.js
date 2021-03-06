'use strict';

var Q = require('q')
var C = require('spacebox-common')

var config = require('./config')
var pubsub = require('./pubsub')

// This module exists only to eliminate a circular dependency between prod and inv
// prod -> inv -> prod_dep
var self = module.exports = {
    destroyFacility: function(facility, db) {
        return pubsub.publish(db.ctx, {
            type: 'facility',
            agent_id: facility.agent_id,
            tombstone: true,
            uuid: facility.id,
            blueprint: facility.blueprint,
        }).then(function() {
            return db.none("delete from facilities where id=$1", facility.id)
        })
    },
    updateFacilities: function(uuid, db) {
        db.assertTx()

        return Q.spread([
            db.inventory.getForUpdateOrFail(uuid, db),
            db.any("select * from facilities where container_id = $1 for update", uuid)
        ], function(container, current_facilities) {
            return Q.all([
                db.blueprints.get(container.doc.blueprint),
                container,
                current_facilities
            ])
        }).spread(function(container_bp, container, current_facilities) {
            if (isNaN(container_bp.capacity) || container_bp.capacity <= 0)
                return

            var these_blueprints = {}

            return Q.fcall(function() {
                return db.blueprints.getMany(container.doc.modules.slice().concat(container_bp.uuid, container_bp.native_modules || [])).
                then(function(list) {
                    return list.filter(function(blueprint) {
                        return (blueprint.facility_type !== undefined)
                    }).map(function(blueprint) {
                        these_blueprints[blueprint.uuid] = blueprint

                        return blueprint.uuid
                    })
                })
            }).then(function(new_facility_modules) {
                var current_facility_modules = current_facilities.map(function(v) {
                        return v.blueprint
                    }),
                    changes = C.compute_array_changes(current_facility_modules, new_facility_modules)

                db.ctx.old_debug('build', 'updateFacilities', container, current_facilities, changes, these_blueprints)
                return changes
            }).tap(function(changes) {
                return Q.all([
                    Q.all(changes.added.map(function(v) {
                        return db.none("insert into facilities (id, agent_id, container_id, blueprint, facility_type, trigger_at, doc) values (uuid_generate_v1(), $1, $2, $3, $4, current_timestamp, $5)", [container.agent_id, uuid, v, these_blueprints[v].facility_type, {}])
                    })),
                    Q.all(C.array_unique(changes.removed).map(function(v) {
                        // If there is still some of the removed facilities
                        // installed, just disabled them and let the use pick
                        if (container.doc.modules.indexOf(v) > -1) {
                            return db.none("update facilities set disabled = true where container_id = $1 and blueprint = $2", [uuid, v])
                        } else { // If there are none remaining, just destroy them
                            return db.many("select * from facilities where container_id = $1 and blueprint = $2 for update", [uuid, v]).
                            then(function(list) {
                                return Q.all(list.map(function(facility) {
                                    return self.destroyFacility(facility, db)
                                }))
                            })
                        }
                    })),
                    Q.all(C.array_unique(changes.unchanged).map(function(v) {
                        return db.none("update facilities set disabled = false where container_id = $1 and blueprint = $2", [uuid, v])
                    }))
                ])
            }).then(function(changes) {
                return pubsub.publish(db.ctx, {
                    type: 'facilities',
                    agent_id: container.agent_id,
                    container_id: uuid,
                    changes: changes
                })
            })
        })
    }
}
