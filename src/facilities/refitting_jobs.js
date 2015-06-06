'use strict';

var Q = require('q'),
    C = require('spacebox-common'),
    production = require('../production_dep.js'),
    inventory = require('../inventory'),
    dao = require('../dao'),
    helpers = require('./helpers')

module.exports = {
    buildJob: function(ctx, job, blueprint, facilityType) {
        // TODO validate the job
        job.duration = 30
    },
    fullfillResources: function(ctx, job, blueprint, container, db) {
        ctx.debug('build', job)

        // This also ensures that the the target is in the container
        return db.one("update items set locked = true where id = $1 and container_id = $2 and container_slice = $3 returning id", [job.target, container.id, job.slice]).
        then(function() {
            return Q.all([
                dao.inventory.getForUpdateOrFail(job.target, db),
                dao.blueprints.getMany(job.modules)
            ], function(target, list) {
                return helpers.prepareRefit(target, list, container, job.slice, ctx, db)
            })
        })
    },
    deliverJob: function(ctx, job, container, db) {
        ctx.debug('build', job)

        return dao.inventory.getForUpdateOrFail(job.target, db).
        then(function(target) {
            return Q.all([
                target,
                dao.blueprints.getMany(job.modules)
            ])
        }).spread(function(target, list) {
            return inventory.setModules(target, list, db)
        }).then(function() {
            return db.one("update items set locked = false where id = $1 returning id", job.target)
        })
    }
}
