'use strict';

var config = require('./config')
var redis = require('spacebox-common-native').buildRedis(config.ctx)

module.exports = {
    publish: function(ctx, message) {
        return redis.publish("techmessages", JSON.stringify(message))
    }
}
