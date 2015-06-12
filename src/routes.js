'use strict';

var C = require('spacebox-common'),
    Q = require('q'),
    redis = require('spacebox-common-native').buildRedis(),
    config = require('./config')

Q.longStackSupport = true

module.exports = function(app) {
    require('./routes/spawn')(app)
    require('./routes/scanning')(app)
    require('./routes/target')(app)

    app.get('/specs', function(req, res) {
        redis.get('stats').then(function(data) {
            res.send({
                stats: JSON.parse(data),
                config: config.game
            })
        }).fail(C.http.errHandler(req, res)).done()
    })
}
