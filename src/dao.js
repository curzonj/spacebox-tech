'use strict';

var DBClass = require('spacebox-common-native/lib/pg-wrapper'),
    config = require('./config'),
    moment = require('moment')

DBClass.extend(function(db) {
    return {
        systems: {
            insert: function(id, doc) {
                return db.
                query("insert into solar_systems (id, doc) values ($1, $2)", [id, doc])
            }
        },
        wormholes: {
            randomGeneratorFn: function(system_id) {
                return function() {
                    return db.query("with available_systems as (select * from system_wormholes where count < $3 and id != $1 and id not in (select inbound_system from wormholes where outbound_system = $1)) insert into wormholes (id, expires_at, outbound_system, inbound_system) select uuid_generate_v1(), current_timestamp + interval $4, $1, (select id from available_systems offset floor(random()*(select count(*) from available_systems)) limit 1) where not exists (select id from system_wormholes where id = $1 and count >= $2) returning id", [system_id, config.game.minimum_count_wormholes, config.game.maximum_count_wormholes, config.game.wormhole_lifetime])
                }
            }
        },
        blueprints: {
            getFull: function(uuid) {
                return db.one("select * from blueprints where id = $1", uuid)
            },
            get: function(uuid) {
                return db.prepared({ name: "get_blueprint", text: "select doc from blueprints where id = $1", values: [ uuid ] }).
                then(function(result) {
                    if (result.rowCount === 0)
                        return null

                    return result.rows[0].doc
                })
            },
            getMany: function(list) {
                return db.many("select doc from blueprints where id in ($1^)", db.as.csv(list)).
                then(function(rows) {
                    return rows.map(function(row) {
                        return row.doc
                    })
                })
            },
            all: function() {
                return db.many("select * from blueprints").
                then(function(rows) {
                    return rows.map(function(row) {
                        return row.doc
                    })
                })
            },
            grantPermission: function(blueprint_id, account_id, can_manufacture, can_research) {
                return db.none("insert into blueprint_perms (blueprint_id, account_id, can_manufacture, can_research) values ($1, $2, $3, $4)", [ blueprint_id, account_id, can_manufacture, can_research ])
            }
        },
        inventory: {
            all: function(account) {
                if (account === undefined) {
                    return db.query("select * from inventories")
                } else {
                    return db.query("select * from inventories where account=$1", [account])
                }
            },
            getForUpdateOrFail: function(uuid) {
                db.assertTx()

                return db.one("select * from inventories where id=$1 for update", uuid)
            },
            getForUpdate: function(uuid) {
                db.assertTx()

                if (uuid === null)
                    return null

                return db.oneOrNone("select * from inventories where id=$1 for update", uuid)
            },
            get: function(uuid) {
                if (uuid === null)
                    return null

                return db.oneOrNone("select * from inventories where id=$1", uuid)
            },
            update: function(uuid, doc) {
                if (db === undefined)
                    db = db

                db.ctx.old_debug('dao', "updating inventory doc", uuid, doc)
                return db.query("update inventories set doc = $2 where id =$1", [uuid, doc])
            },
            insert: function(uuid, doc) {
                return db.
                query("insert into inventories (id, account, doc) values ($1, $2, $3)", [uuid, doc.account, doc])
            },
            destroy: function(uuid) {
                // TODO this should also require that the container is empty
                return db.query("delete from inventories where id = $1", [uuid])
            }
        },
        facilities: {
            all: function(account) {
                if (account === undefined) {
                    return db.query('select * from facilities')
                } else {
                    return db.query('select * from facilities where account = $1', [account])
                }
            },
            needAttention: function() {
                return db.prepared({ name: "facilities_current_trigger_at", text: "select * from facilities where disabled = 'f' and trigger_at is not null and trigger_at < current_timestamp" }).
                then(function(result) {
                    return result.rows
                })
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
                    return db.query("select * from jobs where account=$1", [account])
                }
            },
            get: function(uuid, account) {
                return db.
                query("select * from jobs where id=$1 and account=$1", [uuid, account]).
                then(function(data) {
                    return data[0]
                })
            },
            queue: function(doc) {
                return db.
                query("insert into jobs (id, facility_id, account, doc, status, statusCompletedAt, createdAt, trigger_at) values ($1, $2, $3, $4, $5, current_timestamp, current_timestamp, current_timestamp)", [doc.uuid, doc.facility, doc.account, doc, "queued"])

            },
            nextJob: function(facility_id) {
                return db.
                oneOrNone("select * from jobs where facility_id = $1 and status != 'delivered' order by createdAt limit 1 for update", [facility_id])
            },
            destroy: function(uuid) {
                return db.
                query("delete from jobs where id =$1", [uuid])
            },
            completeStatus: function(uuid, status, doc, trigger_at) {
                if (moment.isMoment(trigger_at)) {
                    trigger_at = trigger_at.toDate()
                }

                return db.
                one("update jobs set status = $2, statusCompletedAt = current_timestamp, doc = $3, trigger_at = $4 where id = $1 returning id", [uuid, status, doc, trigger_at])
            },
            incrementBackoff: function(uuid) {
                return db.
                one("update jobs set next_backoff = next_backoff * 2, trigger_at = current_timestamp + next_backoff where id = $1 returning id", uuid)
            }
        }
    }
})
