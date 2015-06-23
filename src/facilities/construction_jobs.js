'use strict';

var Q = require('q')
var C = require('spacebox-common')

var config = require('../config')
var worldState = config.state

var helpers = require('./helpers')
var production = require('../production_dep')
var inventory = require('../inventory')
var design_api = require('../blueprints')

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
                    return Q.all([
                        design_api.updateVesselBlueprint(job.container_id, blueprint),
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
            return production.updateFacilities(job.container_id, db)
        }).then(function() {
            return db.one("update items set locked = false where id = $1 returning id", container.id)
        })
    }
}
