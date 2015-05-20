'use strict';

var Q = require('q'),
    C = require('spacebox-common'),
    db = require('spacebox-common-native').db,
    dao = require('./dao.js'),
    pubsub = require('./pubsub.js'),
    blueprints = require('./blueprints.js')

// the facility needs a doc because in the future the facility
// may be configured
function build_facility_doc(container, blueprint) {
    return {
        has_resources: (blueprint.production.generate !== undefined)
    }
}

// This module exists only to eliminate a circular dependency between prod and inv
// prod -> inv -> prod_dep
var self = module.exports = {
    destroyFacility: function (facility, db) {
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
            var new_facility_modules = container.doc.modules.concat(container.doc.blueprint).
                    filter(function(v) { return (blueprints[v].production !== undefined) }),
                current_facility_modules =
                    current_facilities.map(function(v) { return v.blueprint }),
                changes = C.compute_array_changes(current_facility_modules, new_facility_modules)

            db.ctx.log('build', 'updateFacilities', container, current_facilities, changes)

            return Q.all([
                Q.all(changes.added.map(function(v) {
                    var doc = build_facility_doc(container, blueprints[v])
                    return db.none("insert into facilities (id, account, inventory_id, blueprint, has_resources, trigger_at, doc) values (uuid_generate_v1(), $1, $2, $3, $4, current_timestamp, $5)", 
                        [ container.account, uuid, v, doc.has_resources, doc ])
                })),
                Q.all(C.array_unique(changes.removed).map(function(v) {
                    // If there is still some of the removed facilities
                    // installed, just disabled them and let the use pick
                    if (container.doc.modules.indexOf(v) > -1) {
                        return db.none("update facilities set disabled = true where inventory_id = $1 and blueprint = $2", [ uuid, v ])
                    } else { // If there are none remaining, just destroy them
                        return db.many("select * from facilities where inventory_id = $1 and blueprint = $2 for update", [ uuid, v ]).
                        then(function(list) {
                            return Q.all(list.map(function(facility) {
                                return self.destroyFacility(facility, db)
                            }))
                        })
                    }
                })),
                Q.all(C.array_unique(changes.unchanged).map(function(v) {
                    var doc = build_facility_doc(container, blueprints[v])
                    return db.none("update facilities set disabled = false, doc = $3 where inventory_id = $1 and blueprint = $2", [ uuid, v, doc ])
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
