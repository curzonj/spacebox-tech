'use strict';

var Q = require('q'),
    C = require('spacebox-common'),
    production = require('../production_dep.js'),
    inventory = require('../inventory'),
    helpers = require('./helpers')

module.exports = {
    buildJob: function(ctx, job, blueprint, facilityType) {
        job.duration = blueprint.build.time

        if (blueprint.build === undefined ||
            blueprint.size > facilityType.max_job_size)
            throw new C.http.Error(422, "invalid_job", {
                msg: "facility is unable to do that"
            })

    },
    fullfillResources: function(ctx, job, blueprint, container, db) {
        ctx.old_debug('build', blueprint)

        return helpers.consumeBuildResources(job.quantity, blueprint.build, container, job.slice, ctx, db)
    },
    deliverJob: function(ctx, job, container, db) {
        return helpers.produce(job.inventory_id, job.slice, [{
            blueprint: job.blueprint,
            quantity: job.quantity
        }], db)
    }

}
