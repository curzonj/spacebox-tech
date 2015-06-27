'use strict';

var Q = require('q')
var C = require('spacebox-common')
var config = require('../config')
var worldState = config.state

function validateSubjectTarget(ctx, subject, target, auth) {
    ctx.trace({subject: subject, target: target, auth: auth}, 'validateSubjectTarget')

    if (subject === null || subject === undefined || subject.agent_id !== auth.agent_id) {
        throw new Error("no such vessel")
    } else if (target === null || target === undefined) {
        throw new Error("no such target")
    } else if (target.solar_system !== subject.solar_system) {
        throw new Error("target not in range")
    }
}

function setState(ship, system, state, patch) {
    if (ship.systems.indexOf(system) === -1)
        throw new Error("that vessel has no "+system+" system")

    patch = patch || {}
    patch.state = state
    var obj = {
        systems: {}
    }
    obj.systems[system] = patch

    return worldState.queueChangeIn(ship.uuid, obj)
}

function getAndCheckVessel(uuid, auth) {
    return worldState.getP(uuid).
    tap(function(ship) {
        if (ship === null || ship.agent_id !== auth.agent_id)
            throw new Error("no such vessel")
    })
}

module.exports = function(app) {
    app.post('/commands/shoot', function(req, res, next) {
        var msg = req.body

        getAndCheckVessel(msg.vessel, req.auth).
        then(function(ship) {
            return setState(ship, 'weapon', 'shoot', {
                target: msg.target
            })
        }).then(function() {
            res.json({
                result: true
            })
        }).fail(next).done()
    })

    app.post('/commands/move_to', function(req, res, next) {
        var msg = req.body

        getAndCheckVessel(msg.vessel, req.auth).
        then(function(ship) {
            return setState(ship, 'engine', 'moveTo', {
                moveTo: C.assertVector(msg.target)
            })
        }).then(function(data) {
            res.json({
                result: true
            })
        }).fail(next).done()
    })

    app.post('/commands/orbit', function(req, res, next) {
        var msg = req.body

        getAndCheckVessel(msg.vessel, req.auth).
        then(function(ship) {
            return setState(ship, 'engine', 'orbit', {
                orbitRadius: msg.radius || 1,
                orbitTarget: C.assertUUID(msg.target),
            })
        }).then(function(data) {
            res.json({
                result: true
            })
        }).fail(next).done()
    })

    app.post('/commands/full_stop', function(req, res, next) {
        var msg = req.body

        getAndCheckVessel(msg.vessel, req.auth).
        then(function(ship) {
            return setState(ship, 'engine', 'fullStop')
        }).then(function(data) {
            res.json({
                result: true
            })
        }).fail(next).done()
    })
}

