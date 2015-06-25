'use strict';

var Q = require('q')
var C = require('spacebox-common')
var uuidGen = require('node-uuid')
var async = require('async-q')

var config = require('../config')
var db = config.db
var worldState = config.state
var solarsystems = require('../solar_systems')
var inventory = require('../inventory')

module.exports = function(app) {
    app.post('/commands/resetAgent', function(req, res, next) {
        var msg = req.body

        return db.query("select * from items where agent_id = $1", req.auth.agent_id).then(function(data) {
            return async.map(data, function(row) {
                // World state will notify us when it has despawned and
                // we can delete everything
                return worldState.queueChangeIn(row.id, {
                    tombstone_cause: 'despawned',
                    tombstone: true
                }).then(function() {
                    return inventory.destroyVessel(req.db, req.ctx, row.id)
                })
            })
        }).then(function() {
            res.send({
                result: true
            })
        }).fail(next).done()
    })
}
