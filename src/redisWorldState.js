'use strict';

var uuidGen = require('node-uuid'),
    config = require('./config.js'),
    Q = require("q"),
    C = require("spacebox-common"),
    redisLib = require('promise-redis')(Q.Promise),
    redis = redisLib.createClient(),
    th = require('spacebox-common/src/three_helpers.js')

module.exports = {
    queueChangeIn: function(uuid, patch) {
        C.assertUUID(uuid)

        if (typeof patch !== 'object' || Object.keys(patch).length === 0)
            throw new Error("invalid patch")

        return redis.rpush("commands", JSON.stringify({
            uuid: uuid,
            patch: patch
        }))
    },
    get: function(uuid) {
        C.assertUUID(uuid)

        return redis.get(uuid).then(function(data) {
            return JSON.parse(data)
        })
    },
    addObject: function(values) {
        values.uuid = values.uuid || uuidGen.v1()

        var self = this,
            uuid = values.uuid

        values.chunk = th.buildVectorBucket(values.position, config.game.chunk_size)

        //debug("added object", uuid, values)
        return self.queueChangeIn(uuid, values).then(function() {
            return uuid
        })
    },
}
