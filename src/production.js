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

function destroyFacility(uuid) {
    return dao.facilities.get(uuid).then(function(facility) {
        pubsub.publish({
            type: 'facility',
            account: facility.account,
            tombstone: true,
            uuid: uuid,
            blueprint: facility.blueprint,
        })
    }).then(function() {
        // delete running_jobs[uuid] TODO when should jobs be cleaned up?
        // delete queued_jobs[uuid]

        return dao.facilities.destroy(uuid)
    })
}

function consume(account, uuid, slice, type, quantity) {
    return blueprints.getData().then(function(blueprints) {
        return inventory.transaction([{
            inventory: uuid,
            slice: slice,
            blueprint: blueprints[type],
            quantity: (quantity * -1)
        }])
    })
}

function produce(account, uuid, slice, type, quantity) {
    return blueprints.getData().then(function(blueprints) {
        return inventory.transaction([{
            inventory: uuid,
            slice: slice,
            blueprint: blueprints[type],
            quantity: quantity
        }])
    })
}

function fullfillResources(data) {
    var job = data.doc

    return Q.all([
        blueprints.getData(),
        dao.jobs.flagNextStatus(data.id, "resourcesFullfilled")
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

        if (job.action == "refine") {
            return consume(job.account, job.facility, job.slice, job.blueprint, job.quantity)
        } else {
            var promises = []
            debug(blueprint)

            for (var key in blueprint.build.resources) {
                var count = blueprint.build.resources[key]
                // TODO do this as a transaction
                promises.push(consume(job.account, job.facility, job.slice, key, count * job.quantity))
            }

            return Q.all(promises)
        }
    }).then(function() {
        var finishAt = moment().add(job.duration * job.quantity, 'seconds')
        job.finishAt = finishAt.unix()
        return dao.jobs.completeStatus(data.id, "resourcesFullfilled", job, finishAt)
    }).then(function() {
        log("fullfilled " + job.uuid + " at " + job.facility)
    }).fail(function(e) {
        error("failed to fullfill " + job.uuid + " at " + job.facility + ": " + e.toString())
        error(e.stack)
        return dao.jobs.failNextStatus(data.id, "resourcesFullfilled")
    }).done()
}

function deliverJob(job) {
    switch (job.action) {
        case "manufacture":
            return produce(job.account, job.facility, job.slice, job.blueprint, job.quantity)

        case "refine":
            var promises = []

            for (var key in job.outputs) {
                var count = job.outputs[key]
                // TODO do this as a transaction
                promises.push(produce(job.account, job.facility, job.slice, key, count * job.quantity))
            }

            return Q.all(promises)
        case "construct":
            return Q.fcall(function() {
                // Updating the facility uuid is because everything
                // is built on a scaffold, so everything starts as a facility
                return C.request('3dsim', 'POST', 204, '/spodb/'+job.facility, {
                    blueprint: job.blueprint })
            }).then(function() {
                return blueprints.getData().then(function(blueprints) {
                    var blueprint = blueprints[job.blueprint]

                    // If a scaffold was upgraded to a non-production
                    // structure, remove the facility tracking
                    if (blueprint.production === undefined) {
                        return destroyFacility(job.facility)
                    } else {
                        return self.updateFacility(job.facility, blueprint, job.account)
                    }
                }).then(function() {
                    return inventory.updateContainer(job.facility, job.blueprint)
                })
            })
    }
}

function jobDeliveryHandling(data) {
    var job = data.doc
    var facility = data.facility_id

    var timestamp = moment.unix(job.finishAt)
    if (timestamp.isAfter(moment())) {
        log('received job '+data.id+' at '+facility+' early: '+moment.unix(job.finishAt).fromNow());
        return
    }

    return dao.jobs.flagNextStatus(data.id, "delivered").
        then(function() {
            return deliverJob(job)
        }).then(function() {
            return dao.jobs.completeStatus(data.id, "delivered", job, moment().add(10, 'years'))
        }).then(function() {
            log("delivered " + job.uuid + " at " + facility)

            pubsub.publish({
                account: job.account,
                type: 'job',
                uuid: job.uuid,
                facility: job.facility,
                state: 'delivered',
            })
        }).fail(function(e) {
            error("failed to deliver job in " + facility + ": " + e.toString())
            return dao.jobs.failNextStatus(data.id, "delivered")
        })
}

function checkAndProcessFacilityJob(facility) {
    return dao.jobs.nextJob(facility.id).then(function(data) {
        if (data === undefined) {
            log("no matching jobs in "+facility.id)
            return
        
        } else {
            debug(data)
        }

        switch(data.status) {
            case "queued":
                return fullfillResources(data)
            case "resourcesFullfilled":
                return jobDeliveryHandling(data)
            case "delivered":
                //return dao.jobs.destroy(data.id)
        }
    })
}

function checkAndDeliverResources(facility) {
    var uuid = facility.id

    debug('resource processing', facility)

    var resource = facility.resources

    if (facility.resourceslastdeliveredat === null) {
        // The first time around this is just a dummy
        return Q(db.query("update facilities set resourcedeliverystartedat = null, resourceslastdeliveredat = current_timestamp where id = $1", [ uuid ]))
    } else if (
        moment(facility.resourceslastdeliveredat).add(resource.period, 's').isBefore(moment()) &&
            facility.resourcedeliverystartedat === null
    ) {
        return Q(db.query("update facilities set resourcedeliverystartedat = current_timestamp where id = $1", [ uuid ])).then(function() {
            return produce(facility.account, uuid, 'default', resource.type, resource.quantity)
        }).tap(C.qDebug('checkAndDeliver')).then(function() {
            pubsub.publish({
                type: 'resources',
                account: facility.account,
                facility: uuid,
                blueprint: resource.type,
                quantity: resource.quantity,
                state: 'delivered'
            })

            return db.query("update facilities set resourcedeliverystartedat = null, next_backoff = '1 second', resourceslastdeliveredat = current_timestamp, trigger_at = $2 where id = $1",
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

            return db.query("update facilities set resourcedeliverystartedat = null, next_backoff = next_backoff * 2, trigger_at = current_timestamp + next_backoff where id = $1",
                            [ uuid ])
        })
    } else {
        if (facility.resourcedeliverystartedat) {
            log("delivery was started for "+uuid+" and I'm still waiting")
        } else {
            log(uuid+" is waiting for "+moment(facility.resourceslastdeliveredat).add(resource.period, 's').diff(moment()))
        }
    }

    return Q(null)
}

var buildWorker = setInterval(function() {
    log("processing jobs")

    // TODO use an iterator
    dao.facilities.needAttention().then(function(data) {
        debug('data', data)

        return Object.keys(data).map(function(i) {
            var facility = data[i]

            debug('facility', facility)

            if (facility.resources === null) {
                return checkAndProcessFacilityJob(facility)
            } else {
                return checkAndDeliverResources(facility)
            }
        })
    }).all().done()
}, 1000) // TODO don't let runs overlap

var self = module.exports = {
    updateFacility: require('./production_dep.js').updateFacility,
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
                    return res.status(404).send("no such facility: " + job.facility)
                }

                // Must wait until we have the auth response to check authorization
                // TODO come up with a better means of authorization
                if (facility.account != auth.account) {
                    return res.status(401).send("not authorized to access that facility")
                }

                var facilityType = blueprints[facility.blueprint]
                var canList = facilityType.production[job.action]
                var blueprint = blueprints[job.blueprint]

                if (canList === undefined || !canList.some(function(e) {
                    return e.item == blueprint.uuid
                })) {
                    debug(canList)
                    debug(job.blueprint)

                    return res.status(400).send("facility is unable to produce that")
                }

                if (job.action == "refine") {
                    job.outputs = blueprint.refine.outputs

                    job.duration = blueprint.refine.time
                } else {
                    job.duration = blueprint.build.time

                    if (job.action == "construct") {
                        job.quantity = 1
                    }
                }

                job.account = auth.account

                return dao.jobs.queue(job).then(function() {
                    res.status(201).send({
                        job: {
                            uuid: job.uuid
                        }
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
            destroyFacility(req.param('uuid')).then(function() {
                res.sendStatus(204)
            }).fail(C.http.errHandler(req, res, error)).done()

        })

        app.post('/facilities/:uuid', function(req, res) {
            var uuid = req.param('uuid')

            var authP = C.http.authorize_req(req, true)
            var inventoryP = authP.then(function(auth) {
                return inventory.dao.get(uuid).then(function(data) {
                    return data.doc
                })
            })

            Q.spread([blueprints.getData(), authP, inventoryP], function(blueprints, auth, container) {
                var blueprint = blueprints[req.body.blueprint]

                if (blueprint && container.blueprint == blueprint.uuid) {
                    return self.updateFacility(uuid, blueprint, auth.account).then(function() {
                        res.status(201).send({
                            facility: {
                                uuid: uuid
                            }
                        })
                    })
                } else {
                    res.status(400).send("no such blueprint")
                }
            }).fail(C.http.errHandler(req, res, error)).done()
        })
    }
}
