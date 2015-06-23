'use strict';

var Q = require('q'),
    C = require('spacebox-common'),
    production = require('../production_dep.js'),
    inventory = require('../inventory'),
    helpers = require('./helpers')

module.exports = {
    buildJob: function(ctx, job, blueprint, facilityType) {
        if (blueprint.refine === undefined)
            throw new C.http.Error(422, "invalid_job", {
                msg: "facility is unable to do that"
            })

        job.outputs = blueprint.refine.outputs
        job.duration = blueprint.refine.time
    },
    fullfillResources: function(ctx, job, blueprint, container, db) {
        return helpers.consume(job.container_id, job.slice, [{
            blueprint: job.blueprint,
            quantity: job.quantity
        }], db)
    },
    deliverJob: function(ctx, job, container, db) {
        return helpers.produce(job.container_id, job.slice, Object.keys(job.outputs).map(function(key) {
            return {
                blueprint: key,
                quantity: job.outputs[key] * job.quantity
            }
        }), db)
    }

}
