'use strict';

var Q = require('q'),
    C = require('spacebox-common'),
    production = require('../production_dep.js'),
    inventory = require('../inventory'),
    design_api = require('../blueprints'),
    dao = require('../dao'),
    helpers = require('./helpers')

module.exports = {
    buildJob: function(ctx, job, blueprint, facilityType) {
        // TODO validate the job and the parameter
        job.duration = 30
    },
    fullfillResources: function(ctx, job, blueprint, container, db) {
        var tech = design_api.techs_data[blueprint.tech]
        
        var step_cost = Math.floor(C.calc_poly({
            parameters: [ "value" ],
            components: tech.parameters[job.parameter].step_cost
        }, { value: blueprint[job.parameter] }))

        return helpers.consume(job.inventory_id, job.slice, [{
            blueprint: "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6",
            quantity: step_cost
        }], db)
    },
    deliverJob: function(ctx, job, container, db) {
        return dao.blueprints.getFull(job.blueprint).
        then(function(row) {
            var blueprint = row.doc,
                tech = design_api.techs_data[blueprint.tech]
            
            var step_size = Math.floor(C.calc_poly({
                parameters: [ "value" ],
                components: tech.parameters[job.parameter].step_size
            }, { value: blueprint[job.parameter] }))

            row.parameters[job.parameter] = row.parameters[job.parameter] + step_size

            return design_api.buildNewBlueprint(row.doc, row.parameters)
        }).then(function(doc) {
            return dao.blueprints.grantPermission(doc.uuid, job.account, true, true)
        })
    }
}
