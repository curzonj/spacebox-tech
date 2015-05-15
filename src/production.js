'use strict';

var uuidGen = require('node-uuid'),
    moment = require('moment'),
    npm_debug = require('debug'),
    log = npm_debug('build:info'),
    error = npm_debug('build:error'),
    debug = npm_debug('build:debug'),
    Q = require('q'),
    db = require('spacebox-common-native').db,
    C = require('spacebox-common')

var dao = require('./dao.js'),
    pubsub = require('./pubsub.js'),
    blueprints = require('./blueprints.js'),
    inventory = require('./inventory.js')

function consume(db, account, uuid, slice, type, quantity) {
    return blueprints.getData().then(function(blueprints) {
        return inventory.transaction([{
            inventory: uuid,
            slice: slice,
            blueprint: blueprints[type],
            quantity: (quantity * -1)
        }], db)
    })
}

function produce(db, account, uuid, slice, type, quantity) {
    return blueprints.getData().then(function(blueprints) {
        return inventory.transaction([{
            inventory: uuid,
            slice: slice,
            blueprint: blueprints[type],
            quantity: quantity
        }], db)
    })
}

function fullfillResources(data, db) {
    var job = data.doc

    return Q.all([
        blueprints.getData(),
        dao.jobs.lockJobForUpdate(data.id, db)
    ]).spread(function(blueprints) {
        var blueprint = blueprints[job.blueprint]

        pubsub.publish({
            type: 'job',
            account: job.account,
            uuid: job.uuid,
            facility: job.facility,
            state: 'started',
        })

        log("running " + job.uuid + " at " + job.facility)

        switch(job.action) {
            case 'refine':
                return consume(db, job.account, job.facility, job.slice, job.blueprint, job.quantity)
            case 'refit':
                debug(job)

                var next = Q(null)

                if(blueprint.type === 'spaceship') {
                    next = next.then(function() {
                        db.
                        one("update ships set status = 'refitting' where id = $1 and container_id = $2 and container_slice = $3 and status = 'docked' returning id",
                            [ job.target, job.facility, job.slice ])
                    })
                } else if(blueprint.type == 'structure') {
                    if (job.facility != job.target)
                        throw("a structure can only refit itself")
                } else {
                    throw("unknown type for refitting: "+blueprint.type)
                }

                return next.then(function() {
                    return inventory.dao.get(job.target, db)
                }).then(function(row) {
                    var current_modules = row.doc.modules.slice()
                    debug("current modules", current_modules)
                    debug("current cargo", row.doc.cargo)

                    return job.modules.reduce(function(next, key) {
                        return next.then(function() {
                            var i = current_modules.indexOf(key)
                            if (i > -1) {
                                current_modules.splice(i, 1)
                            } else {
                                return consume(db, job.account, job.facility, job.slice, key, 1)
                            }
                        })
                    }, Q(null))
                })
            default:
                debug(blueprint)
                return Q.all(Object.keys(blueprint.build.resources).map(function(key) {
                    var count = blueprint.build.resources[key]
                    return consume(db, job.account, job.facility, job.slice, key, count * job.quantity)
                }))
        }
    }).then(function() {
        var finishAt = moment().add(job.duration * job.quantity, 'seconds')
        job.finishAt = finishAt.unix()
        return dao.jobs.completeStatus(data.id, "resourcesFullfilled", job, finishAt, db)
    }).then(function() {
        log("fullfilled " + job.uuid + " at " + job.facility)
    })
}

function deliverJob(job, db) {
    switch (job.action) {
        case "manufacture":
            return produce(db, job.account, job.facility, job.slice, job.blueprint, job.quantity)

        case "refine":
            return Q.all(Object.keys(job.outputs).map(function(key) {
                var count = job.outputs[key]
                return produce(db, job.account, job.facility, job.slice, key, count * job.quantity)
            }))
        case "refit":
            debug(job)

            return inventory.dao.getForUpdateOrFail(job.target, db).
            then(function(container) {
                var current_modules = container.doc.modules.slice(),
                    job_modules = job.modules.slice()

                var left_overs = current_modules.reduce(function(next, key) {
                    return next.then(function(list) {
                        var i = job_modules.indexOf(key)
                        if (i > -1) {
                            job_modules.splice(i, 1)
                        } else {
                            // if it wasn't needed for the job we'll return it
                            list.push(key)
                        }

                        return list
                    })
                }, Q([]))

                return Q.spread([ left_overs, blueprints.getData() ], function(left_overs, blueprints) {
                    return inventory.transaction(
                        left_overs.map(function(mod) {
                            return {
                                inventory: job.facility,
                                slice: job.slice,
                                quantity: 1,
                                blueprint:  blueprints[mod],
                            }
                        }), db)
                }).then(function() {
                    // The transaction modified the inventory above if the target is a
                    // structure, so we have to refetch it
                    return db.one("select * from inventories where id = $1", job.target).
                    then(function(container) {
                        container.doc.modules = job.modules.slice()

                        debug("updated modules", container.doc.modules)
                        debug("updated inventory", container.doc.cargo)

                        return inventory.dao.update(job.target, container.doc, db)
                    })
                })
            }).then(function() {
                return db.one("update ships set status = 'docked' where id = $1 and status = 'refitting' returning id", job.target).fail(function(e) {
                    return db.any("select * from ships").then(function(data) {
                        console.log('all ships', data)
                    })

                    throw e
                })
            })
        case "construct":
            // Updating the facility uuid is because everything
            // is built on a scaffold, so everything starts as a facility
            return C.request('3dsim', 'POST', 204, '/spodb/'+job.facility, {
                blueprint: job.blueprint }).
            then(function() {
                return inventory.dao.getForUpdateOrFail(job.facility, db).
                then(function(container) {
                    var left_overs = container.doc.modules.slice()
                    if (left_overs.length > 0) {
                        container.doc.modules = []

                        return inventory.dao.update(container.id, container.doc, db).
                        then(function() {
                            // If the inventory transaction fails, it will fail
                            // the inventory update too
                            return inventory.transaction(
                                left_overs.map(function(mod) {
                                    return {
                                        inventory: job.facility,
                                        slice: job.slice,
                                        quantity: 1,
                                        blueprint:  blueprints[mod],
                                    }
                                }), db)
                        }).then(function() {
                            // get the latest for the next update
                            return inventory.dao.getForUpdate(job.facility, db)
                        })
                    } else {
                        return container
                    }
                }).then(function(container) {
                    return blueprints.getData().
                    then(function(blueprints) {
                        inventory.updateContainer(container, blueprints[job.blueprint], db)
                    })
                }).then(function() {
                    return self.updateFacility(job.facility, job.account, db)
                })
            })
    }
}

function jobDeliveryHandling(data, db) {
    var job = data.doc
    var facility = data.facility_id

    var timestamp = moment.unix(job.finishAt)
    if (timestamp.isAfter(moment())) {
        log('received job '+data.id+' at '+facility+' early: '+moment.unix(job.finishAt).fromNow());
        return
    }

    return dao.jobs.lockJobForUpdate(data.id, db).
    then(function() {
        return deliverJob(job, db)
    }).then(function() {
        return dao.jobs.completeStatus(data.id, "delivered", job, moment().add(10, 'years'), db)
    }).then(function() {
        log("delivered " + job.uuid + " at " + facility)

        pubsub.publish({
            account: job.account,
            type: 'job',
            uuid: job.uuid,
            facility: job.facility,
            state: 'delivered',
        })
    })
}

function checkAndProcessFacilityJob(facility) {
    var job

    return db.tx(function(db) {
        return dao.jobs.nextJob(facility.id, db).then(function(data) {
            if (data === null) {
                debug("no matching jobs in "+facility.id)
                return
            
            } else {
                job = data
                debug('job', data)
            }

            switch(data.status) {
                case "queued":
                    return fullfillResources(job, db)
                case "resourcesFullfilled":
                    return jobDeliveryHandling(job, db)
                case "delivered":
                    //return dao.jobs.destroy(data.id)
            }
        })
    }) .fail(function(e) {
        error("failed to handle job in", facility, ": " + e.toString())
        error(e.stack)

        if (job !== undefined && job.id !== undefined)
            return dao.jobs.incrementBackoff(job.id)
    })
}

function checkAndDeliverResources(facility, db) {
    var uuid = facility.id

    debug('resource processing', facility)

    var resource = facility.resources

    db.tx(function(db) {
        if (facility.resources_delivered_at === null) {
            // The first time around this is just a dummy
            return db.query("update facilities set resources_delivered_at = current_timestamp and trigger_at = $2 where id = $1", [ uuid, moment().add(resource.period, 's').toDate() ])
        } else if (
            moment(facility.resources_delivered_at).add(resource.period, 's').isBefore(moment())
        ) {
            return produce(db, facility.account, uuid, 'default', resource.type, resource.quantity).
            tap(C.qDebug('checkAndDeliver')).then(function() {
                pubsub.publish({
                    type: 'resources',
                    account: facility.account,
                    facility: uuid,
                    blueprint: resource.type,
                    quantity: resource.quantity,
                    state: 'delivered'
                })

                return db.query("update facilities set next_backoff = '1 second', resources_delivered_at = current_timestamp, trigger_at = $2 where id = $1",
                                [ uuid, moment().add(resource.period, 's').toDate() ])
            }).fail(function(e) {
                error("failed to deliver resources from "+uuid+": "+e.toString())

                pubsub.publish({
                    type: 'resources',
                    account: facility.account,
                    facility: uuid,
                    blueprint: resource.type,
                    quantity: resource.quantity,
                    state: 'delivery_failed'
                })

                // TODO is this the right thing to do?
                // don't fail the entire transaction, but the
                // only reason for this  is a inventory that is full
                return db.query("update facilities set next_backoff = next_backoff * 2, trigger_at = current_timestamp + next_backoff where id = $1", uuid)
            })
        } else {
            log(uuid+" is waiting for "+moment(facility.resources_delivered_at).add(resource.period, 's').diff(moment()))

            return Q(null)
        }
    })
}

var jobRoundInProgress = false;
var buildWorker = setInterval(function() {
    var now = moment().unix()

    if (jobRoundInProgress) {
        debug("job processing not complete, skipping round")
        return
    }

    jobRoundInProgress = true;
    debug("processing jobs ts="+now)

    // TODO use an iterator
    return dao.facilities.needAttention().then(function(data) {
        debug('data', data)

        // Within a transaction, everything needs to be sequential
        return Object.keys(data).reduce(function(next, i) {
            var facility = data[i]

            debug('facility', facility)

            if (facility.has_resources) {
                return next.then(function() {
                    return checkAndDeliverResources(facility)
                })
            } else {
                return next.then(function() {
                    return checkAndProcessFacilityJob(facility)
                })
            }
        }, Q(null))
    }).then(function() {
        debug('done processing round ts='+now)
    }).fin(function() {
        jobRoundInProgress = false
    }).fail(function(e) {
        throw e
    }).done()
}, 1000) // TODO don't let runs overlap

var prod_dep = require('./production_dep.js')
var self = module.exports = {
    updateFacility: prod_dep.updateFacility,
    destroyFacility: prod_dep.destroyFacility,
    router: function(app) {
        app.get('/jobs/:uuid', function(req, res) {
            C.http.authorize_req(req).then(function(auth) {
                return dao.jobs.get(req.param('uuid'), auth.account).
                    then(function(data) {
                        res.send(data)
                    })
            }).fail(C.http.errHandler(req, res, error)).done()
        })

        app.get('/jobs', function(req, res) {
            C.http.authorize_req(req).then(function(auth) {
                return dao.jobs.
                    all(auth.privileged && req.param('all') == 'true' ? undefined : auth.account).
                    then(function(data) {
                        res.send(data)
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
            debug(req.body)

            var job = req.body
            var duration = -1

            job.uuid = uuidGen.v1()

            Q.spread([blueprints.getData(), C.http.authorize_req(req), dao.facilities.get(job.facility)], function(blueprints, auth, facility) {
                if (facility === undefined) {
                    throw new C.http.Error(404, "no_such_facility", {
                        msg: "no such facility: " + job.facility,
                        facility: job.facility
                    })
                }

                // Must wait until we have the auth response to check authorization
                // TODO come up with a better means of authorization
                if (facility.account != auth.account) {
                    throw new C.http.Error(401, "invalid_job", {
                        msg: "not authorized to access that facility"
                    })
                }

                var facilityType = blueprints[facility.blueprint]
                var canList = facilityType.production[job.action]
                var blueprint = blueprints[job.blueprint]

                if (canList === undefined || !canList.some(function(e) {
                    return e.item == blueprint.uuid
                })) {
                    debug(canList)
                    debug(job.blueprint)

                    throw new C.http.Error(422, "invalid_job", {
                        msg: "facility is unable to produce that"
                    })
                }


                var next = Q(null)

                switch(job.action) {
                    case 'refine':
                        job.outputs = blueprint.refine.outputs
                        job.duration = blueprint.refine.time
                        break;
                    case 'refit':
                        job.duration = 30

                        next.then(function() {
                            return inventory.dao.get(job.target)
                        }).then(function(row) {
                            if (row.doc.blueprint !== job.blueprint)
                                throw new C.http.Error(422, "blueprint_mismatch", {
                                    target: row,
                                    blueprint: blueprint
                                })
                        })

                        break;
                    default:
                        job.duration = blueprint.build.time

                        if (job.action == "construct")
                            job.quantity = 1
                }

                job.account = auth.account

                return next.then(function() {
                    dao.jobs.queue(job).then(function() {
                        res.status(201).send({
                            job: {
                                uuid: job.uuid
                            }
                        })
                    })
                })
            }).fail(C.http.errHandler(req, res, error)).done()
        })

        app.get('/facilities', function(req, res) {
            C.http.authorize_req(req).then(function(auth) {
                if (auth.privileged && req.param('all') == 'true') {
                    return dao.facilities.all()
                } else {
                    return dao.facilities.all(auth.account)
                }
            }).then(function(list) {
                res.send(list)
            }).fail(C.http.errHandler(req, res, error)).done()
        })

        // When a ship or production structure is destroyed
        app.delete('/facilities/:uuid', function(req, res) {
            db.tx(function(db) {
                return self.destroyFacility(req.param('uuid'), db)
            }).then(function() {
                res.sendStatus(204)
            }).fail(C.http.errHandler(req, res, error)).done()
        })
    }
}
