'use strict';

require('../db_config')

var solarsystems = require('../solar_systems.js')

//setInterval(solarsystems.checkWormholeTTL, 60000)

/*
        if (patch.tombstone === true && old.tombstone !== true) {
            // Ideally these would go out in guaranteed order via a journal
            dao.tombstone(uuid).then(function() {
                if ((patch.tombstone_cause === 'destroyed' || patch.tombstone_cause === 'despawned') && old.type == 'vessel') {
                    C.request('tech', 'DELETE', 204, '/vessels/' + uuid)
                }
            }).done()
        }

       DELETE /vessels/:uuid
                var uuid = req.param('uuid')

                return db.tx(req.ctx, function(db) {
                    return dao.getForUpdateOrFail(uuid, db).
                    then(function(container) {
                        return db.any("select * from facilities where inventory_id = $1", uuid)
                    }).then(function(list) {
                        return Q.all(list.map(function(facility) {
                            return production.destroyFacility(facility, db)
                        }))
                    }).then(function() {
                        return dao.destroy(uuid, db)
                    }).then(function() {
                        return db.none("delete from items where id = $1", uuid)
                    }).then(function() {
                        res.sendStatus(204)
                    })
                })


        if (keys_to_update_on.some(function(i) {
                return patch.hasOwnProperty(i)
            })) {

            // Ideally these would go out in guaranteed order via a journal
            dao.update(uuid, old).done()
        }
*/

solarsystems.whenIsReady().
then(function() {
    console.log('server ready')
})
