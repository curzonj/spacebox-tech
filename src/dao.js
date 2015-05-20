'use strict';

var db = require('spacebox-common-native').db,
    moment = require('moment')

module.exports = {
    inventory: {
        all: function(account) {
            if (account === undefined) {
                return db.query("select * from inventories")
            } else {
                return db.query("select * from inventories where account=$1", [ account ])
            }
        },
        getForUpdateOrFail: function(uuid, dbC) {
            if (dbC === undefined)
                throw new Error("failed to pass a transaction: getForUpdateOrFail")

            dbC.assertTx()

            return dbC.one("select * from inventories where id=$1 for update", uuid)
        },
        getForUpdate: function(uuid, dbC) {
            if (dbC === undefined)
                throw new Error("failed to pass a transaction: getForUpdate")

            dbC.assertTx()

            if (uuid === null)
                return null

            return dbC.oneOrNone("select * from inventories where id=$1 for update", uuid)
        },
        get: function(uuid, dbC) {
            if (uuid === null)
                return null

            return (dbC || db).oneOrNone("select * from inventories where id=$1", uuid)
        },
        update: function(uuid, doc, dbC) {
            if (dbC === undefined)
                dbC = db

            dbC.ctx.debug('dao', "updating inventory doc", uuid, doc)
            return dbC.query("update inventories set doc = $2 where id =$1", [ uuid, doc ])
        },
        insert: function(uuid, doc, dbC) {
            return (dbC || db).
                query("insert into inventories (id, account, doc) values ($1, $2, $3)",
                      [ uuid, doc.account, doc ])
        },
        destroy: function (uuid, dbC) {
            // TODO this should also require that the container is empty
            return (dbC || db).query("delete from inventories where id = $1", [ uuid ])
        }
    },
    facilities: {
        all: function(account) {
            if (account === undefined) {
                return db.query('select * from facilities')
            } else {
                return db.query('select * from facilities where account = $1', [ account ])
            }
        },
        needAttention: function() {
            return db.query("select * from facilities where disabled = 'f' and trigger_at is not null and trigger_at < current_timestamp")
        },
        get: function(uuid) {
            return db.one("select * from facilities where id=$1", uuid)
        },
        incrementBackoff: function(uuid) {
            return db.
                one("update facilities set next_backoff = next_backoff * 2, trigger_at = current_timestamp + next_backoff where id = $1 returning id", uuid)
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
        nextJob: function(facility_id, db) {
            return db.
                oneOrNone("select * from jobs where facility_id = $1 and status != 'delivered' order by createdAt limit 1 for update", [ facility_id ])
        },
        destroy: function(uuid) {
            return db.
                query("delete from jobs where id =$1", [ uuid ])
        },
        completeStatus: function(uuid, status, doc, trigger_at, db) {
            if (moment.isMoment(trigger_at)) {
                trigger_at = trigger_at.toDate()
            }

            return db.
                one("update jobs set status = $2, statusCompletedAt = current_timestamp, doc = $3, trigger_at = $4 where id = $1 returning id", [ uuid, status, doc, trigger_at ])
        },
        incrementBackoff: function(uuid) {
            return db.
                one("update jobs set next_backoff = next_backoff * 2, trigger_at = current_timestamp + next_backoff where id = $1 returning id", uuid)
        }
    }
}
