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
    patch = patch || {}
    patch.state = state
    var obj = {
        systems: {}
    }
    obj.systems[system] = patch

    return worldState.queueChangeIn(ship.uuid, obj)
}

module.exports = function(app) {
    app.post('/commands/shoot', function(req, res, next) {
        var msg = req.body
        var ship = worldState.get(msg.vessel)
        var target = worldState.get(msg.target)

        validateSubjectTarget(req.ctx, ship, target, req.auth)

        if (ship.systems.weapon === undefined)
            throw new Error("that vessel has no weapons")

        setState(ship, 'weapon', 'shoot', {
            target: msg.target
        }).then(function() {
            res.json({
                result: true
            })
        }).fail(next).done()
    })

    app.post('/commands/move_to', function(req, res, next) {
        var msg = req.body
        var ship = worldState.get(msg.vessel)

        if (ship === null || ship.agent_id !== req.auth.agent_id)
            throw new Error("no such vessel")

        setState(ship, 'engine', 'moveTo', {
            moveTo: C.assertVector(msg.target)
        }).then(function(data) {
            res.json({
                result: data
            })
        }).fail(next).done()
    })

    app.post('/commands/orbit', function(req, res, next) {
        var msg = req.body

        var ship = worldState.get(msg.vessel)
        var target = worldState.get(msg.target)

        validateSubjectTarget(req.ctx, ship, target, req.auth)

        setState(ship, 'engine', 'orbit', {
            orbitRadius: msg.radius || 1,
            orbitTarget: msg.target
        }).then(function(data) {
            res.json({
                result: data
            })
        }).fail(next).done()
    })

    app.post('/commands/full_stop', function(req, res, next) {
        var msg = req.body
        var ship = worldState.get(msg.vessel)

        if (ship === null || ship.agent_id !== req.auth.agent_id)
            throw new Error("no such vessel")

        setState(ship, 'engine', 'fullStop').
        then(function(data) {
            res.json({
                result: data
            })
        }).fail(next).done()
    })
}

