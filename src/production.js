'use strict';

var uuidGen = require('node-uuid')
var moment = require('moment')
var Q = require('q')
var C = require('spacebox-common')
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
        db.inventory.getForUpdateOrFail(job.inventory_id, db),
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
        pubsub.publish(ctx, {
            type: 'job',
            account: job.account,
            uuid: job.uuid,
            facility: job.facility,
            state: 'started',
        })

        ctx.info({ job_id: job.uuid }, 'resources fullfilled')
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

    return db.inventory.getForUpdateOrFail(job.inventory_id, db).
    then(function(container) {
        return jobHandlers.deliverJob(ctx, job, container, db)
    }).then(function() {
        return db.jobs.completeStatus(data.id, "delivered", job, moment().add(10, 'years'))
    }).then(function() {
        return db.none("update facilities set current_job_id = null, next_backoff = '1 second', trigger_at = current_timestamp where id = $1", job.facility)
    }).then(function() {
        ctx.info({ job_id: job.id }, 'delivered job')

        pubsub.publish(ctx, {
            account: job.account,
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

        pubsub.publish(ctx, {
            type: 'job',
            account: job.account,
            uuid: job.uuid,
            facility: job.facility,
            error: e
        })


        if (process.env.PEXIT_ON_JOB_FAIL == '1') {
            process.nextTick(function() {
                console.log("exiting for job "+job.id+" debugging per ENV['PEXIT_ON_JOB_FAIL']")
                process.exit()
            })
        }

        if (job !== undefined && job.id !== undefined)
            return db.jobs.incrementBackoff(job.id)
    })
}

setInterval(function() {
    var jobRoundInProgress = false
    var ctx = config.ctx

    function build_worker_fn(ctx) {
        if (jobRoundInProgress) {
            ctx.error("job processing not complete, skipping round")
            return
        }

        jobRoundInProgress = true;

        ctx.trace("start processing jobs")
        var dbC = db.tracing(ctx)

        return dbC.facilities.needAttention().then(function(data) {
            // Within a transaction, this needs to be sequential
            return data.reduce(function(next, facility) {
                ctx.trace({ facility: facility }, 'processing facility')

                if (facility.facility_type == 'generating') {
                    return next.then(function() {
                        return generating.checkAndDeliverResources(ctx, facility.id, dbC)
                    })
                } else {
                    return next.then(function() {
                        return checkAndProcessFacilityJob(ctx, facility.id, dbC)
                    })
                }
            }, Q(null))
        }).then(function() {
            ctx.trace('done processing jobs')
        }).fin(function() {
            jobRoundInProgress = false
        }).fail(function(e) {
            throw e
        }).done()
    }

    return function() {
        return build_worker_fn(
            ctx.child({ ts: moment().unix() })
        )
    }
}(), config.game.job_processing_interval)

var prod_dep = require('./production_dep.js')
var self = module.exports = {
    updateFacilities: prod_dep.updateFacilities,
    destroyFacility: prod_dep.destroyFacility,
    router: function(app) {
        app.get('/jobs/:uuid', function(req, res) {
            C.http.authorize_req(req).then(function(auth) {
                return db.jobs.get(req.param('uuid'), auth.account).
                then(function(data) {
                    res.json(data)
                })
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })

        app.get('/jobs', function(req, res) {
            C.http.authorize_req(req).then(function(auth) {
                return db.jobs.
                all(auth.privileged && req.param('all') == 'true' ? undefined : auth.account).
                then(function(data) {
                    res.json(data)
                })
            })
        })

        // players cancel jobs
        app.delete('/jobs/:uuid', function(req, res) {
            // does the user get the resources back?
            // not supported yet
            res.sendStatus(404)
        })

        // players queue jobs
        app.post('/jobs', function(req, res) {
            var job = req.body
            var duration = -1

            job.uuid = uuidGen.v1()

            Q.spread([C.http.authorize_req(req), db.facilities.get(job.facility)], function(auth, facility) {
                // Must wait until we have the auth response to check authorization
                // TODO come up with a better means of authorization
                if (facility.account != auth.account)
                    throw new C.http.Error(401, "invalid_job", {
                        msg: "not authorized to access that facility"
                    })

                return Q.all([
                    auth,
                    facility,
                    db.blueprints.get(facility.blueprint)
                ])
            }).spread(function(auth, facility, facilityType) {
                job.account = auth.account
                job.inventory_id = facility.inventory_id
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
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })

        app.post('/facilities', function(req, res) {
            var uuid = req.param('container_id')

            C.http.authorize_req(req).then(function(auth) {
                return db.tx(req.ctx, function(db) {
                    return self.updateFacilities(uuid, db).
                    then(function() {
                        return db.many("select * from facilities where account = $1 and inventory_id = $2", [auth.account, uuid])
                    })
                })
            }).then(function(list) {
                res.json(list)
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })

        app.get('/facilities', function(req, res) {
            C.http.authorize_req(req).then(function(auth) {
                if (auth.privileged && req.param('all') == 'true') {
                    return db.facilities.all()
                } else {
                    return db.facilities.all(auth.account)
                }
            }).then(function(list) {
                res.json(list)
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })

        /*
         * You can only delete disabled facilities
         * deleting a facility cancels any jobs running there
         * cancelling a job you lose both the output and the
         *      input, that may change in the future.
         */
        app.delete('/facilities/:uuid', function(req, res) {
            C.http.authorize_req(req).then(function(auth) {
                return db.tx(function(db) {
                    return db.one("select * from facilities where id=$1 and account = $2 and disabled = 't' for update", [req.param('uuid'), auth.account]).
                    then(function(facility) {
                        return self.destroyFacility(facility, db)
                    })
                }).then(function() {
                    res.sendStatus(204)
                })
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })
    }
}
