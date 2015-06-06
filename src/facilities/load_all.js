'use strict';

var jobTypes = ['construction', 'manufacturing', 'refining', 'refitting', 'research']

var handlers = jobTypes.reduce(function(acc, type) {
    acc[type] = require('./' + type + '_jobs.js')
    return acc
}, {})

module.exports = {
    buildJob: function(ctx, job) {
        return handlers[job.action].buildJob.apply(null, arguments)
    },
    fullfillResources: function(ctx, job) {
        return handlers[job.action].fullfillResources.apply(null, arguments)
    },
    deliverJob: function(ctx, job) {
        return handlers[job.action].deliverJob.apply(null, arguments)
    }
}
