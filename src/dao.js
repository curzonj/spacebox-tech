'use strict';

var db = require('spacebox-common-native').db,
    moment = require('moment'),
    npm_debug = require('debug'),
    log = npm_debug('build:info'),
    error = npm_debug('build:error'),
    debug = npm_debug('build:debug')

module.exports = {
    facilities: {
        all: function(account) {
            if (account === undefined) {
                return db.query('select * from facilities')
            } else {
                return db.query('select * from facilities where account = $1', [ account ])
            }
        },
        needAttention: function() {
            return db.query('select * from facilities where trigger_at is null or trigger_at < current_timestamp')
        },
        upsert: function(uuid, doc, dbC) {
            return (dbC || db).tx(function(db) {
                return db.query('update facilities set blueprint = $2, account = $3, resources = $4 where id =$1 returning id', [ uuid, doc.blueprint, doc.account, doc.resources ]).
                then(function(data) {
                    debug(data)
                    if (data.length === 0) {
                        return db.
                            query('insert into facilities (id, blueprint, account, resources) values ($1, $2, $3, $4)', [ uuid, doc.blueprint, doc.account, doc.resources ])
                    }
                })
            })
        },
        get: function(uuid) {
            return db.
                query("select * from facilities where id=$1", [ uuid ]).
                then(function(data) {
                    return data[0]
                })
        }
    
    },
    jobs: {
        all: function(account) {
            if (account === undefined) {
                return db.query("select * from jobs")
            } else {
                return db.query("select * from jobs where account=$1", [ account ])
            }
        },
        get: function(uuid, account) {
            return db.
                query("select * from jobs where id=$1 and account=$1", [ uuid, account ]).
                then(function(data) {
                    return data[0]
                })
        },
        queue: function(doc) {
            return db.
                query("insert into jobs (id, facility_id, account, doc, status, statusCompletedAt, createdAt, trigger_at) values ($1, $2, $3, $4, $5, current_timestamp, current_timestamp, current_timestamp)", [ doc.uuid, doc.facility, doc.account, doc, "queued" ])
        
        },
        nextJob: function(facility_id) {
            return db.
                query("with thenextjob as (select * from jobs where facility_id = $1 and status != 'delivered' order by createdAt limit 1) select * from thenextjob where next_status is null and trigger_at < current_timestamp", [ facility_id ]).
                then(function(data) {
                    return data[0]
                })
        },
        destroy: function(uuid) {
            return db.
                query("delete from jobs where id =$1", [ uuid ])
        },
        flagNextStatus: function(uuid, status, db) {
            return db.
                one("update jobs set next_status = $2, nextStatusStartedAt = current_timestamp where nextStatusStartedAt is null and id = $1 returning id", [ uuid, status ])
        },
        completeStatus: function(uuid, status, doc, trigger_at, db) {
            if (moment.isMoment(trigger_at)) {
                trigger_at = trigger_at.toDate()
            }

            return db.
                one("update jobs set status = next_status, statusCompletedAt = current_timestamp, next_status = null, nextStatusStartedAt = null, doc = $3, trigger_at = $4 where id = $1 and next_status = $2 returning id", [ uuid, status, doc, trigger_at ])
        },
        incrementBackoff: function(uuid) {
            return db.
                one("update jobs set next_backoff = next_backoff * 2, trigger_at = current_timestamp + next_backoff where id = $1 returning id", uuid)
        }
    }
}
