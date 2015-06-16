'use strict';

var Q = require('q')
var C = require('spacebox-common')
var production = require('../production_dep.js')
var inventory = require('../inventory')
var design_api = require('../blueprints')
var helpers = require('./helpers')
var config = require('../config')

module.exports = {
    buildJob: function(ctx, job, blueprint, facilityType) {
        // TODO validate the job and the parameter
        job.duration = 30
    },
    fullfillResources: function(ctx, job, blueprint, container, db) {
        var tech = config.design_techs[blueprint.tech]
        
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
        return db.blueprints.getFull(job.blueprint).
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
            return db.blueprints.grantPermission(doc.uuid, job.account, true, true)
        })
    }
}
