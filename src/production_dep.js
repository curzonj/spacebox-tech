'use strict';

var dao = require('./dao.js'),
    pubsub = require('./pubsub.js')

module.exports = {
    updateFacility: function(uuid, blueprint, account) {
        if (blueprint.production === undefined) {
            throw new Error(uuid+" is not a production facility")
        }

        return dao.facilities.upsert(uuid, {
            blueprint: blueprint.uuid, 
            account: account,
            resources: blueprint.production.generate
        }).then(function() {
            pubsub.publish({
                type: 'facility',
                account: account,
                uuid: uuid,
                blueprint: blueprint.uuid,
            })
        })
    }
}
