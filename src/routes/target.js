'use strict';

var Q = require('q'),
    C = require('spacebox-common'),
    worldState = require('../redisWorldState.js')

function validateSubjectTarget(subject, target, auth) {
    if (subject === null || subject.account !== auth.account) {
        throw new Error("no such subject")
    } else if (target === null) {
        throw new Error("no such target")
    } else if (target.solar_system !== subject.solar_system) {
        throw new Error("")
    }
}

function setState(ship, system, state, patch) {
    patch = patch || {}
    patch.state = state
    var obj = {
        systems: {}
    }
    obj.systems[system] = patch

    return worldState.queueChangeIn(ship.uuid, obj)
}

module.exports = function(app) {
    app.post('/commands/shoot', function(req, res) {
        var msg = req.body

        Q.spread([
            C.http.authorize_req(req),
            worldState.get(msg.vessel),
            worldState.get(msg.target),
        ], function(auth, ship, target) {
            validateSubjectTarget(ship, target, auth)

            setState(ship, 'weapon', 'shoot', {
                target: msg.target
            }).then(function(data) {
                res.send({
                    result: data
                })
            })
        }).fail(C.http.errHandler(req, res, console.log)).done()
    })

    app.post('/commands/move_to', function(req, res) {
        var msg = req.body

        Q.spread([
            C.http.authorize_req(req),
            worldState.get(msg.vessel),
        ], function(auth, ship) {
            if (ship === null || ship.account !== auth.account)
                throw new Error("no such vessel")

            setState(ship, 'engine', 'moveTo', {
                moveTo: msg.target
            }).then(function(data) {
                res.send({
                    result: data
                })
            })
        }).fail(C.http.errHandler(req, res, console.log)).done()
    })

    app.post('/commands/orbit', function(req, res) {
        var msg = req.body

        Q.spread([
            C.http.authorize_req(req),
            worldState.get(msg.vessel),
            worldState.get(msg.target),
        ], function(auth, ship, target) {
            validateSubjectTarget(ship, target, auth)

            setState(ship, 'engine', 'orbit', {
                orbitRadius: msg.radius || 1,
                orbitTarget: msg.target
            }).then(function(data) {
                res.send({
                    result: data
                })
            })
        }).fail(C.http.errHandler(req, res, console.log)).done()
    })

    app.post('/commands/full_stop', function(req, res) {
        var msg = req.body

        Q.spread([
            C.http.authorize_req(req),
            worldState.get(msg.vessel),
        ], function(auth, ship) {
            if (ship === null || ship.account !== auth.account)
                throw new Error("no such vessel")

            setState(ship, 'engine', 'fullStop').
            then(function(data) {
                res.send({
                    result: data
                })
            })
        }).fail(C.http.errHandler(req, res, console.log)).done()
    })


}

