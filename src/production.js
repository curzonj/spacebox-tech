'use strict';

var uuidGen = require('node-uuid')
var moment = require('moment')
var Q = require('q')
var C = require('spacebox-common')
var async = require('async-q')
var pubsub = require('./pubsub')
var inventory = require('./inventory')
var generating = require('./facilities/generating')
var jobHandlers = require('./facilities/load_all')
var config = require('./config')
var db = config.db

function fullfillResources(ctx, data, db) {
    var job = data.doc

    return Q.all([
        Q.fcall(function() {
            if (job.action !== 'refitting')
                return db.blueprints.get(job.blueprint)
        }),
        db.inventory.getForUpdateOrFail(job.container_id, db),
        db.query("select id from facilities where id = $1 for update", job.facility)
    ]).spread(function(blueprint, container) {
        ctx.info({ job_id: job.id }, 'starting job')
        return jobHandlers.fullfillResources(ctx, job, blueprint, container, db)
    }).then(function() {
        var duration = job.duration * job.quantity

        if (config.game.short_jobs === true)
            duration = 1

        var finishAt = moment().add(duration, 'seconds')
        job.finishAt = finishAt.unix()
        return db.jobs.completeStatus(data.id, "resourcesFullfilled", job, finishAt).
        then(function() {
            return db.none("update facilities set current_job_id = $2, trigger_at = $3, next_backoff = '1 second' where id = $1", [job.facility, data.id, finishAt.toDate()])
        })
    }).then(function() {
        ctx.info({ job_id: job.uuid }, 'resources fullfilled')

        return pubsub.publish(ctx, {
            type: 'job',
            agent_id: job.agent_id,
            uuid: job.uuid,
            facility: job.facility,
            state: 'started',
        })
    })
}

function jobDeliveryHandling(ctx, data, db) {
    var job = data.doc
    var facility = data.facility_id

    var timestamp = moment.unix(job.finishAt)
    if (timestamp.isAfter(moment())) {
        ctx.warn({ early_diff: moment.unix(job.finishAt).fromNow(), job_id: data.id }, 'recevied job early')
        return
    }

    return db.inventory.getForUpdateOrFail(job.container_id, db).
    then(function(container) {
        return jobHandlers.deliverJob(ctx, job, container, db)
    }).then(function() {
        return db.jobs.completeStatus(data.id, "delivered", job, moment().add(10, 'years'))
    }).then(function() {
        return db.none("update facilities set current_job_id = null, next_backoff = '1 second', trigger_at = current_timestamp where id = $1", job.facility)
    }).then(function() {
        ctx.info({ job_id: job.id }, 'delivered job')

        return pubsub.publish(ctx, {
            agent_id: job.agent_id,
            type: 'job',
            uuid: job.uuid,
            facility: job.facility,
            state: 'delivered',
        })
    })
}

function checkAndProcessFacilityJob(ctx, facility_id, db) {
    var job

    return db.tx(function(db) {
        return db.one("select id from facilities where id = $1 for update", facility_id).
        then(function() {
            return db.jobs.nextJob(facility_id)
        }).then(function(data) {
            if (data === null) {
                ctx.warn({ facility_id: facility_id }, 'no jobs on triggered facility')
                return db.none("update facilities set trigger_at = null where id = $1", facility_id)
            } else {
                job = data
                ctx.trace({ job: data, facility_id: facility_id }, 'processing job')

                if (moment(job.trigger_at).isAfter(moment())) {
                    return db.none("update facilities set trigger_at = $2 where id = $1", [facility_id, job.trigger_at])
                }
            }

            switch (data.status) {
                case "queued":
                    return fullfillResources(ctx, job, db)
                case "resourcesFullfilled":
                    return jobDeliveryHandling(ctx, job, db)
                case "delivered":
                    //return db.jobs.destroy(data.id)
            }
        })
    }).fail(function(e) {
        ctx.error({ err: e, facility_id: facility_id, job: job }, 'failed to handle job')

        return pubsub.publish(ctx, {
            type: 'job',
            agent_id: job.agent_id,
            job_id: job.id,
            facility_id: facility_id,
            error: e.message
        }).then(function() {
            if (process.env.PEXIT_ON_TOUGH_ERROR == '1')
                process.nextTick(function() {
                    console.log("exiting for debugging per ENV['PEXIT_ON_TOUGH_ERROR']")
                    process.exit()
                })

            if (job !== undefined && job.id !== undefined)
                return db.jobs.incrementBackoff(job.id)
        })
    })
}

var prod_dep = require('./production_dep.js')
var self = module.exports = {
    updateFacilities: prod_dep.updateFacilities,
    destroyFacility: prod_dep.destroyFacility,
    build_worker_fn: function() {
        var jobRoundInProgress = false

        return function() {
            var ctx = config.ctx.child({ ts: moment().unix() })
            if (jobRoundInProgress) {
                ctx.error("job processing not complete, skipping round")
                return
            }

            jobRoundInProgress = true;

            ctx.trace("start processing jobs")
            var db = config.db.tracing(ctx)

            return db.facilities.needAttention().then(function(data) {
                // Within a transaction, this needs to be sequential
                return async.eachSeries(data,
                function(facility) {
                    ctx.trace({ facility: facility }, 'processing facility')

                    if (facility.facility_type == 'generating') {
                        return generating.checkAndDeliverResources(ctx, facility.id, db)
                    } else {
                        return checkAndProcessFacilityJob(ctx, facility.id, db)
                    }
                })
            }).then(function() {
                ctx.trace('done processing jobs')
            }).fin(function() {
                jobRoundInProgress = false
            }).done()
        }
    }(),
    router: function(app) {
        app.get('/jobs/:uuid', function(req, res, next) {
            return db.jobs.get(req.param('uuid'), req.auth.agent_id).
            then(function(data) {
                res.json(data)
            }).fail(next).done()
        })

        app.get('/jobs', function(req, res, next) {
            return db.jobs.
            all(req.auth.privileged && req.param('all') == 'true' ? undefined : req.auth.agent_id).
            then(function(data) {
                res.json(data)
            }).fail(next).done()
        })

        // players cancel jobs
        app.delete('/jobs/:uuid', function(req, res, next) {
            // does the user get the resources back?
            // not supported yet
            res.sendStatus(404)
        })

        // players queue jobs
        app.post('/jobs', function(req, res, next) {
            handleJobs(req.body.action, req, res).fail(next).done()
        })

        app.post('/jobs/:action_name', function(req, res, next) {
            handleJobs(req.params.action_name, req, res).fail(next).done()
        })

        function handleJobs(job_action, req, res) {
            var job = req.body
            var duration = -1

            if (!job.slice)
                job.slice = 'default'
            if (!job.quantity)
                job.quantity = 1

            job.uuid = uuidGen.v1()

            return db.facilities.get(job.facility).
            then(function(facility) {
                if (facility.facility_type !== job_action)
                    throw new C.http.Error(422, "job action must match facility")

                // Must wait until we have the auth response to check authorization
                // TODO come up with a better means of authorization
                if (facility.agent_id != req.auth.agent_id)
                    throw new C.http.Error(401, "invalid_job", {
                        msg: "not authorized to access that facility"
                    })

                return Q.all([
                    facility,
                    db.blueprints.get(facility.blueprint)
                ])
            }).spread(function(facility, facilityType) {
                job.agent_id = req.auth.agent_id
                job.container_id = facility.container_id
                job.action = facilityType.facility_type

                return Q.fcall(function() {
                    if (facilityType.facility_type !== 'refitting')
                        return db.blueprints.get(job.blueprint)
                }).then(function(blueprint) {
                    return jobHandlers.buildJob(req.ctx, job, blueprint, facilityType)
                }).then(function() {
                    return db.jobs.queue(job)
                }).then(function() {
                    return db.none("update facilities set next_backoff = '1 second', trigger_at = current_timestamp where id = $1", job.facility)
                }).then(function() {
                    res.status(201).send({
                        job: {
                            uuid: job.uuid
                        }
                    })
                })
            })
        }

        app.post('/facilities', function(req, res, next) {
            var uuid = req.param('container_id')

            return db.tx(req.ctx, function(db) {
                return self.updateFacilities(uuid, db).
                then(function() {
                    return db.any("select * from facilities where agent_id = $1 and container_id = $2", [req.auth.agent_id, uuid])
                })
            }).then(function(list) {
                res.json(list)
            }).fail(next).done()
        })

        app.get('/facilities', function(req, res, next) {
            Q.fcall(function() {
                if (req.auth.privileged && req.param('all') == 'true') {
                    return db.facilities.all()
                } else {
                    return db.facilities.all(req.auth.agent_id)
                }
            }).then(function(list) {
                res.json(list)
            }).fail(next).done()
        })

        /*
         * You can only delete disabled facilities
         * deleting a facility cancels any jobs running there
         * cancelling a job you lose both the output and the
         *      input, that may change in the future.
         */
        app.delete('/facilities/:uuid', function(req, res, next) {
            return db.tx(function(db) {
                return db.one("select * from facilities where id=$1 and agent_id = $2 and disabled = 't' for update", [req.param('uuid'), req.auth.agent_id]).
                then(function(facility) {
                    return self.destroyFacility(facility, db)
                })
            }).then(function() {
                res.sendStatus(204)
            }).fail(next).done()
        })
    }
}
