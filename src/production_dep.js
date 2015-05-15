'use strict';

var Q = require('q'),
    db = require('spacebox-common-native').db,
    dao = require('./dao.js'),
    pubsub = require('./pubsub.js'),
    blueprints = require('./blueprints.js')

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

    updateFacility: function(uuid, account, db) {
        return Q.spread([
            blueprints.getData(),
            dao.inventory.getForUpdateOrFail(uuid, db),
        ], function(blueprints, container) {
            console.log(container)
            var blueprint = blueprints[container.doc.blueprint],
                production = blueprint.production

            if (production === undefined) {
                return self.destroyFacility(uuid, db)
            } else {

                return dao.facilities.upsert(uuid, {
                    blueprint: blueprint.uuid, 
                    account: account,
                    resources: (production.generate !== undefined)
                }, db).then(function() {
                    pubsub.publish({
                        type: 'facility',
                        account: account,
                        uuid: uuid,
                        blueprint: blueprint.uuid,
                    })
                })
            }
        })
    }
}
