'use strict';

var Q = require("q")
var C = require("spacebox-common")
var buildRedis = require('spacebox-common-native').buildRedis
var uuidGen = require('node-uuid')

module.exports = function(logger) {
    var redis= buildRedis(logger)

    logger.measure({
        redisRequest: 'timer'
    })

    var self = {
        queueChangeIn: function(uuid, patch) {
            C.assertUUID(uuid)

            if (typeof patch !== 'object' || Object.keys(patch).length === 0)
                throw new Error("invalid patch")

            return redis.rpush("commands", JSON.stringify({
                uuid: uuid,
                patch: patch
            }))
        },
        getP: function(uuid) {
            var response = uuidGen.v1()
            var start = Date.now()

            return redis.rpush('requests', JSON.stringify({
                response: response,
                key: uuid
            })).then(function() {
                return redis.blpop(response, 0)
            }).then(function(result) {
                logger.trace({ responseKey: response, result: result[1].toString() }, 'redis request response')
                return JSON.parse(result[1].toString())
            }).fin(function(result) {
                var duration = Date.now() - start
                logger.redisRequest.update(duration)
                logger.trace({ responseKey: response, uuid: uuid, response: result, duration: duration }, 'redisRequest')
            })
        }
    }

    return self
}
