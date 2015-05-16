'use strict';

var Q = require('q'),
    db = require('spacebox-common-native').db,
    dao = require('./dao.js'),
    pubsub = require('./pubsub.js'),
    blueprints = require('./blueprints.js')

function array_unique(a) {
    return a.filter(function(e, p) {
        return (a.indexOf(e) == p)
    
    })
}

function compute_array_changes(original, current) {
    function which_removed(a1, a2) {
        var copy = a2.slice(),
            removed = []

        // if we have any facilities for which we no longer
        // have modules installed, disable them for resolution
        a1.forEach(function(v) {
            var i = copy.indexOf(v)
            if (i > -1) {
                copy.splice(i, 1)
            } else {
                removed = removed.concat(v)
            }
        })

        return removed
    }

    function which_unchanged(original, removed) {
        return original.filter(function(v) {
            return (removed.indexOf(v) > -1)
        })
    }

    var changes = {
        added: which_removed(current, original),
        removed: which_removed(original, current)
    }

    changes.unchanged = which_unchanged(original, changes.removed)

    return changes
}

// the facility needs a doc because in the future the facility
// may be configured
function build_facility_doc(container, blueprint) {
    return {
        has_resources: (blueprint.production.generate !== undefined)
    }
}

var self = module.exports = {
    destroyFacility: function (uuid, db) {
        return dao.inventory.getForUpdateOrFail(uuid, db).
        then(function(facility) {
            pubsub.publish({
                type: 'facility',
                account: facility.account,
                tombstone: true,
                uuid: uuid,
                blueprint: facility.blueprint,
            })
        }).then(function() {
            // delete running_jobs[uuid] TODO when should jobs be cleaned up?
            // delete queued_jobs[uuid]

            return db.none("delete from facilities where id=$1", uuid)
        })
    },

    updateFacilities: function(uuid, db) {
        return Q.spread([
            blueprints.getData(),
            dao.inventory.getForUpdateOrFail(uuid, db),
            db.any("select * from facilities where inventory_id = $1 for update", uuid)
        ], function(blueprints, container, current_facilities) {
            var new_facility_modules = container.doc.modules.concat(container.doc.blueprint).
                    filter(function(v) { return (blueprints[v].production !== undefined) }),
                current_facility_modules =
                    current_facilities.map(function(v) { return v.blueprint }),
                changes = compute_array_changes(current_facility_modules, new_facility_modules)

            console.log('updateFacilities', container, current_facilities, changes)

            return Q.all([
                changes.added.map(function(v) {
                    var doc = build_facility_doc(container, blueprints[v])
                    return db.none("insert into facilities (id, account, inventory_id, blueprint, has_resources, doc) values (uuid_generate_v1(), $1, $2, $3, $4, $5)", 
                        [ container.account, uuid, v, doc.has_resources, doc ])
                }),
                array_unique(changes.removed).map(function(v) {
                    return db.none("update facilities set disabled = true where inventory_id = $1 and blueprint = $2", [ uuid, v ])
                }),
                array_unique(changes.unchanged).map(function(v) {
                    var doc = build_facility_doc(container, blueprints[v])
                    return db.none("update facilities set disabled = false, doc = $3 where inventory_id = $1 and blueprint = $2", [ uuid, v, doc ])
                })
            ]).then(function() {
                pubsub.publish({
                    type: 'facilities',
                    account: container.account,
                    inventory: uuid,
                    changes: changes
                })
            })
        })
    }
}
