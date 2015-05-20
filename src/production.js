'use strict';

var uuidGen = require('node-uuid'),
    moment = require('moment'),
    Q = require('q'),
    db = require('spacebox-common-native').db,
    C = require('spacebox-common')

var dao = require('./dao.js'),
    pubsub = require('./pubsub.js'),
    blueprints = require('./blueprints.js'),
    inventory = require('./inventory.js')

function produce( uuid, slice, items, db) {
    return updateInventory('produce', uuid, slice, items, db)
}

function consume( uuid, slice, items, db) {
    return updateInventory('consume', uuid, slice, items, db)
}

function updateInventory(action, uuid, slice, items, db) {
    return Q.spread([
        blueprints.getData(),
        dao.inventory.getForUpdateOrFail(uuid, db),
    ], function(blueprints, container) {
        var args

        if (!Array.isArray(items))
            items = [ items ]

        switch(action) {
            case 'produce':
                args = [ null, null, container, slice ]
                break;
            case 'consume':
                args = [ container, slice, null, null ]
                break;
            default:
                throw new Error("invalid inventory action: "+action)
        }

        args.push(items.map(function(item) {
            return {
                blueprint: blueprints[item.blueprint],
                quantity: item.quantity
            }
        }), db)

        return inventory.transfer.apply(inventory, args).tap(function() {
            db.ctx.debug('build', 'contents after', action, container.cargo)
        })
    })
}

function fullfillResources(ctx, data, db) {
    var job = data.doc

    return Q.all([
        blueprints.getData(),
        dao.inventory.getForUpdateOrFail(job.inventory_id, db),
        db.query("select id from facilities where id = $1 for update", job.facility)
    ]).spread(function(blueprints, container, _) {
        var blueprint = blueprints[job.blueprint]

        pubsub.publish(ctx, {
            type: 'job',
            account: job.account,
            uuid: job.uuid,
            facility: job.facility,
            state: 'started',
        })

        ctx.log('build', "running " + job.uuid + " at " + job.facility)

        switch(job.action) {
            case 'refine':
                return consume(job.inventory_id, job.slice, [{
                    blueprint: job.blueprint,
                    quantity: job.quantity
                }], db)
            case 'refit':
                ctx.debug('build', job)

                var next = Q(null)

                if(blueprint.type === 'spaceship') {
                    next = next.then(function() {
                        db.
                        one("update ships set status = 'refitting' where id = $1 and container_id = $2 and container_slice = $3 and status = 'docked' returning id",
                            [ job.target, job.inventory_id, job.slice ])
                    })
                } else if(blueprint.type == 'structure') {
                    if (job.inventory_id != job.target)
                        throw("a structure can only refit itself")
                } else {
                    throw("unknown type for refitting: "+blueprint.type)
                }

                var changes = C.compute_array_changes(container.doc.modules, job.modules)
                return next.then(function() {
                    return consume(job.inventory_id, job.slice, changes.added.map(function(mod) {
                        return {
                            blueprint: mod,
                            quantity: 1
                        }
                    }), db)
                })
            default:
                ctx.debug('build', blueprint)

                return consume(job.inventory_id, job.slice, 
                    Object.keys(blueprint.build.resources).map(function(key) {
                        return {
                            blueprint: key,
                            quantity: job.quantity * blueprint.build.resources[key]
                        }
                    }), db)
        }
    }).then(function() {
        var finishAt = moment().add(job.duration * job.quantity, 'seconds')
        job.finishAt = finishAt.unix()
        return dao.jobs.completeStatus(data.id, "resourcesFullfilled", job, finishAt, db).
        then(function() {
            return db.none("update facilities set current_job_id = $2, trigger_at = $3, next_backoff = '1 second' where id = $1", [ job.facility, data.id, finishAt.toDate()])
        })
    }).then(function() {
        ctx.log('build', "fullfilled " + job.uuid + " at " + job.facility)
    })
}

function deliverJob(ctx, job, db) {
    // refit and construct below depends on the return value of this
    var next = dao.inventory.getForUpdateOrFail(job.inventory_id, db)

    switch (job.action) {
        case "manufacture":
            return next.then(function() {
                return produce(job.inventory_id, job.slice, [{
                    blueprint: job.blueprint,
                    quantity: job.quantity
                }], db)
            })

        case "refine":
            return next.then(function() {
                return produce(job.inventory_id, job.slice, Object.keys(job.outputs).map(function(key) {
                    return {
                        blueprint: key,
                        quantity: job.outputs[key] * job.quantity
                    }
                }), db)
            })
        case "refit":
            ctx.debug('build', job)

            return next.then(function(container) {
                var changes = C.compute_array_changes(container.doc.modules, job.modules)

                return produce(job.inventory_id, job.slice, changes.removed.map(function(key) {
                    return {
                        blueprint: key,
                        quantity: 1
                    }
                }), db).then(function() {
                    // The transaction modified the inventory above returning leftovers
                    return dao.inventory.getForUpdateOrFail(job.target, db).
                    then(function(container) {
                        container.doc.modules = job.modules.slice()

                        ctx.debug('build', "updated modules", container.doc.modules)
                        ctx.debug('build', "updated inventory", container.doc.cargo)

                        return inventory.dao.update(job.target, container.doc, db)
                    })
                })
            }).then(function() {
                return self.updateFacilities(job.inventory_id, db)
            }).then(function() {
                return blueprints.getData()
            }).then(function(blueprints) {
                if (blueprints[job.blueprint].type === 'spaceship')
                    return db.one("update ships set status = 'docked' where id = $1 and status = 'refitting' returning id", job.target).fail(function(e) {
                        return db.any("select * from ships").then(function(data) {
                            console.log('all ships', data)
                        })

                        throw e
                    })
            })
        case "construct":
            return next.tap(function(_) {
                return C.request('3dsim', 'POST', 204, '/spodb/'+job.inventory_id, {
                    blueprint: job.blueprint })
            }).then(function(container) {
                var left_overs = container.doc.modules.slice()
                if (left_overs.length > 0) {
                    container.doc.modules = []

                    return inventory.dao.update(container.id, container.doc, db).
                    then(function() {
                        // get the latest for the next update
                        return inventory.dao.getForUpdateOrFail(job.inventory_id, db)
                    }).then(function() {
                        // If the inventory transaction fails, it will fail
                        // the inventory update too
                        return produce(job.inventory_id, job.slice, left_overs.map(function(key) {
                            return {
                                blueprint: key,
                                quantity: 1
                            }
                        }), db)
                    }).then(function() {
                        // get the latest for the next update
                        return inventory.dao.getForUpdateOrFail(job.inventory_id, db)
                    })
                } else {
                    return container
                }
            }).then(function(container) {
                return blueprints.getData().
                then(function(blueprints) {
                    // This may change the capacity, but the leftover modules go into
                    // the inventory whether there is room or not
                    return inventory.updateContainer(ctx, container, blueprints[job.blueprint], db)
                })
            }).then(function() {
                return self.updateFacilities(job.inventory_id, db)
            })
    }
}

function jobDeliveryHandling(ctx, data, db) {
    var job = data.doc
    var facility = data.facility_id

    var timestamp = moment.unix(job.finishAt)
    if (timestamp.isAfter(moment())) {
        ctx.log('build', 'received job '+data.id+' at '+facility+' early: '+moment.unix(job.finishAt).fromNow());
        return
    }

    return deliverJob(ctx, job, db).
    then(function() {
        return dao.jobs.completeStatus(data.id, "delivered", job, moment().add(10, 'years'), db)
    }).then(function() {
        return db.none("update facilities set current_job_id = null, next_backoff = '1 second', trigger_at = current_timestamp where id = $1", job.facility)
    }).then(function() {
        ctx.log('build', "delivered " + job.uuid + " at " + facility)

        pubsub.publish(ctx, {
            account: job.account,
            type: 'job',
            uuid: job.uuid,
            facility: job.facility,
            state: 'delivered',
        })
    })
}

function checkAndProcessFacilityJob(ctx, facility_id) {
    var job

    return db.tx(ctx, function(db) {
        return db.one("select id from facilities where id = $1 for update", facility_id).
        then(function() {
            return dao.jobs.nextJob(facility_id, db)
        }).then(function(data) {
            if (data === null) {
                ctx.debug('build', "no matching jobs in "+facility_id)
                return db.none("update facilities set trigger_at = null where id = $1", facility_id)
            } else {
                job = data
                ctx.debug('build', 'job', data)

                if (moment(job.trigger_at).isAfter(moment())) {
                    return db.none("update facilities set trigger_at = $2 where id = $1", [ facility_id, job.trigger_at ])
                }
            }

            switch(data.status) {
                case "queued":
                    return fullfillResources(ctx, job, db)
                case "resourcesFullfilled":
                    return jobDeliveryHandling(ctx, job, db)
                case "delivered":
                    //return dao.jobs.destroy(data.id)
            }
        })
    }).fail(function(e) {
        ctx.log('build', "failed to handle job in", facility_id, ": " + e.toString())
        ctx.log('build', e.stack)
        process.exit()

        if (job !== undefined && job.id !== undefined)
            return dao.jobs.incrementBackoff(job.id)
    })
}

function checkAndDeliverResources(ctx, uuid) {
    return db.tx(ctx, function(db) {
        return Q.spread([
            blueprints.getData(),
            db.one("select * from facilities where id = $1 for update", uuid)
        ], function(blueprints, facility) {
            var blueprint = blueprints[facility.blueprint]
            var resource = blueprint.production.generate

            if (resource === undefined)
                throw new Error(facility.id+" has no resources, but tried to produce them")

            ctx.debug('build', 'resource processing', facility, blueprint)
            
            if (facility.doc.resources_checked_at === undefined) {
                facility.doc.resources_checked_at = moment()
                // The first time around this is just a dummy
                return db.query("update facilities set trigger_at = $2, doc = $3 where id = $1", [ uuid, moment().add(resource.period, 's').toDate(), facility.doc ])
            } else if (
                moment(facility.doc.resources_checked_at).add(resource.period, 's').isBefore(moment())
            ) {
                return produce(facility.inventory_id, 'default', [{ blueprint: resource.type, quantity: resource.quantity}], db).
                then(function() {
                    pubsub.publish(ctx, {
                        type: 'resources',
                        account: facility.account,
                        facility: uuid,
                        blueprint: resource.type,
                        quantity: resource.quantity,
                        state: 'delivered'
                    })

                    facility.doc.resources_checked_at = moment()
                    return db.query("update facilities set trigger_at = $2, next_backoff = '1 second', doc = $3 where id = $1", [ uuid, moment().add(resource.period, 's').toDate(), facility.doc ])
                }).fail(function(e) {
                    pubsub.publish(ctx, {
                        type: 'resources',
                        account: facility.account,
                        facility: uuid,
                        blueprint: resource.type,
                        quantity: resource.quantity,
                        state: 'delivery_failed'
                    })

                    throw e
                })
            } else {
                ctx.log('build', uuid+" is waiting for "+moment(facility.doc.resources_checked_at).add(resource.period, 's').diff(moment()))

                return Q(null)
            }
        })
    }).fail(function(e) {
        ctx.log('build', "failed to deliver resources from "+uuid+": "+e.toString())
        return dao.facilities.incrementBackoff(uuid)
    })
}

setInterval(function() {
    var jobRoundInProgress = false,
        ctx = new C.TracingContext()

    function build_worker_fn(ctx) {
        if (jobRoundInProgress) {
            ctx.log('build', "job processing not complete, skipping round")
            return
        }

        jobRoundInProgress = true;

        ctx.log('build', "start processing jobs")
        return dao.facilities.needAttention().then(function(data) {
            // Within a transaction, everything needs to be sequential
            return data.reduce(function(next, facility) {
                ctx.debug('build', 'facility', facility)

                if (facility.has_resources) {
                    return next.then(function() {
                        return checkAndDeliverResources(ctx, facility.id)
                    })
                } else {
                    return next.then(function() {
                        return checkAndProcessFacilityJob(ctx, facility.id)
                    })
                }
            }, Q(null))
        }).then(function() {
            ctx.log('build', 'done processing jobs')
        }).fin(function() {
            jobRoundInProgress = false
        }).fail(function(e) {
            throw e
        }).done()
    }

    return function() {
        return ctx.log_with(function(ctx) {
            build_worker_fn(ctx)
        }, "ts="+moment().unix(), 'build')
    }
}(), 1000)

var prod_dep = require('./production_dep.js')
var self = module.exports = {
    updateFacilities: prod_dep.updateFacilities,
    destroyFacility: prod_dep.destroyFacility,
    router: function(app) {
        app.get('/jobs/:uuid', function(req, res) {
            C.http.authorize_req(req).then(function(auth) {
                return dao.jobs.get(req.param('uuid'), auth.account).
                    then(function(data) {
                        res.send(data)
                    })
            }).fail(C.http.errHandler(req, res, console.log)).done()
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
            req.ctx.debug('build', req.body)

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

                job.inventory_id = facility.inventory_id

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
                    req.ctx.debug('build', canList)
                    req.ctx.debug('build', job.blueprint)

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
                        return db.none("update facilities set next_backoff = '1 second', trigger_at = current_timestamp where id = $1", job.facility)
                    }).then(function() {
                        res.status(201).send({
                            job: {
                                uuid: job.uuid
                            }
                        })
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
                        return db.many("select * from facilities where account = $1 and inventory_id = $2", [ auth.account, uuid ])
                    })
                })
            }).then(function(list) {
                res.send(list)
            }).fail(C.http.errHandler(req, res, console.log)).done()
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
                    return db.one("select * from facilities where id=$1 and account = $2 and disabled = 't' for update", [ req.param('uuid'), auth.account ]).
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
