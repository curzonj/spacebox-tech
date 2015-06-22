'use strict';

var Q = require('q')
var C = require('spacebox-common')
var uuidGen = require('node-uuid')

var config = require('../config')
var db = config.db
var worldState = config.state
var solarsystems = require('../solar_systems')

module.exports = function(app) {
    app.post('/commands/resetAccount', function(req, res) {
        C.http.authorize_req(req).then(function(auth) {
            var msg = req.body

            return db.query("select * from items where account = $1", auth.account).then(function(data) {
                return Q.all(data.map(function(row) {
                    // World state will notify us when it has despawned and
                    // we can delete everything
                    return worldState.queueChangeIn(row.id, {
                        tombstone_cause: 'despawned',
                        tombstone: true
                    })
                }))
            }).then(function() {
                res.send({
                    result: true
                })
            })
        }).fail(C.http.errHandler(req, res, console.log)).done()
    })
}
