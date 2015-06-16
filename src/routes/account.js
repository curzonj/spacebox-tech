'use strict';

var Q = require('q'),
    uuidGen = require('node-uuid'),
    db = require('spacebox-common-native').db,
    C = require('spacebox-common')

var worldState = require('spacebox-common-native/src/redis-state'),
    solarsystems = require('../solar_systems.js')

module.exports = function(app) {
    app.post('/commands/resetAccount', function(req, res) {
        C.http.authorize_req(req).then(function(auth) {
            var msg = req.body

            return db.query("select * from space_objects where tombstone = 'f' and account_id = $1", auth.account).then(function(data) {
                return Q.all(data.map(function(row) {
                    // World state will notify inventory which will delete
                    // both containers and facilities
                    return worldState.queueChangeIn(row.id, {
                        tombstone_cause: 'despawned',
                        tombstone: true
                    })
                }))
            }).then(function(data) {
                res.send({
                    result: data
                })
            })
        }).fail(C.http.errHandler(req, res, console.log)).done()
    })
}
