'use strict';

var Q = require('q')
var C = require('spacebox-common')
var moment = require('moment')
var uuidGen = require('node-uuid')

var config = require('../config')
var db = config.db
var pubsub = require('../pubsub')
var inventory = require('../inventory')
var helpers = require('./helpers')

module.exports = {

    checkAndDeliverResources: function(ctx, uuid, db) {
        return db.tx(function(db) {
            return db.one("select * from facilities where id = $1 for update", uuid).
            then(function(facility) {
                return db.blueprints.get(facility.blueprint).
                then(function(blueprint) {
                    return [blueprint, facility]
                })
            }).spread(function(blueprint, facility) {
                ctx.old_debug('build', 'resource processing', facility, blueprint)

                if (facility.doc.resources_checked_at === undefined) {
                    facility.doc.resources_checked_at = moment()
                        // The first time around this is just a dummy
                    return db.query("update facilities set trigger_at = $2, doc = $3 where id = $1", [uuid, moment().add(blueprint.generating_period, 'm').toDate(), facility.doc])
                } else if (
                    moment(facility.doc.resources_checked_at).add(blueprint.generating_period, 'm').isBefore(moment())
                ) {
                    return helpers.produce(facility.inventory_id, 'default', [{
                        blueprint: blueprint.generated_resource,
                        quantity: blueprint.generating_quantity
                    }], db).
                    then(function() {
                        pubsub.publish(ctx, {
                            type: 'resources',
                            account: facility.account,
                            facility: uuid,
                            blueprint: blueprint.generated_resource,
                            quantity: blueprint.generating_quantity,
                            state: 'delivered'
                        })

                        facility.doc.resources_checked_at = moment()
                        return db.query("update facilities set trigger_at = $2, next_backoff = '1 second', doc = $3 where id = $1", [uuid, moment().add(blueprint.generating_period, 'm').toDate(), facility.doc])
                    }).fail(function(e) {
                        pubsub.publish(ctx, {
                            type: 'resources',
                            account: facility.account,
                            facility: uuid,
                            blueprint: blueprint.generated_resource,
                            quantity: blueprint.generating_quantity,
                            error: e.message,
                        })

                        throw e
                    })
                } else {
                    ctx.old_log('build', uuid + " is waiting for " + moment(facility.doc.resources_checked_at).add(blueprint.generating_period, 'm').diff(moment()))

                    return Q(null)
                }
            })
        }).fail(function(e) {
            ctx.old_log('build', "failed to deliver resources from " + uuid + ": " + e.toString())
            ctx.old_log('build', e.stack)

            return db.facilities.incrementBackoff(uuid)
        })
    }

}
