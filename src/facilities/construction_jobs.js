'use strict';

var Q = require('q'),
    C = require('spacebox-common'),
    production = require('../production_dep.js'),
    inventory = require('../inventory'),
    worldState = require('spacebox-common-native/lib/redis-state'),
    helpers = require('./helpers')

module.exports = {
    buildJob: function(ctx, job, blueprint, facilityType) {
        job.quantity = 1
        job.duration = 0

        job.change_blueprint = (blueprint.uuid !== facilityType.uuid)

        if (job.change_blueprint) {
            job.duration = blueprint.build.time

            if (blueprint.tech !== facilityType.tech ||
                blueprint.build === undefined)
                throw new C.http.Error(422, "invalid_job", {
                    msg: "facility is unable to do that"
                })
        }

        if (job.modules !== undefined)
            job.duration = job.duration + 30

        // TODO validate that what ever the final modules
        // will be that the structure supports them

    },
    fullfillResources: function(ctx, job, blueprint, container, db) {
        return db.none("update items set locked = true where id = $1", container.id).
        then(function() {
            if (job.change_blueprint) {
                return helpers.consumeBuildResources(job.quantity, blueprint.build, container, job.slice, ctx, db)
            }
        }).then(function() {
            if (job.modules !== undefined) {
                return db.blueprints.getMany(job.modules).
                then(function(list) {
                    return helpers.prepareRefit(container, list, container, job.slice, ctx, db)
                })
            }
        })
    },
    deliverJob: function(ctx, job, container, db) {
        return Q.fcall(function() {
            if (job.change_blueprint) {
                return db.blueprints.get(job.blueprint).
                then(function(blueprint) {
                    var new_obj = JSON.parse(JSON.stringify(blueprint))
                    new_obj.blueprint = blueprint.uuid
                    delete new_obj.uuid

                    // TODO what happens to a structure's health when it's
                    // upgraded?
                    // TODO what about changes to structure modules?

                    return Q.all([
                        worldState.queueChangeIn(job.inventory_id, new_obj),
                        inventory.updateContainer(ctx, container, blueprint, db)
                    ])
                })
            }
        }).then(function() {
            if (job.modules !== undefined) {
                return db.blueprints.getMany(job.modules).
                then(function(list) {
                    return inventory.setModules(container, list, db)
                })
            }
        }).then(function() {
            return production.updateFacilities(job.inventory_id, db)
        }).then(function() {
            return db.one("update items set locked = false where id = $1 returning id", container.id)
        })
    }
}
