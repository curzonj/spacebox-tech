'use strict';

var http = require("http"),
    express = require("express"),
    bodyParser = require('body-parser'),
    uuidGen = require('node-uuid'),
    Q = require('q'),
    WTF = require('wtf-shim'),
    config = require('./config.js'),
    C = require('spacebox-common')

C.logging.configure('api')
require('./db_config')

var worldState = require('spacebox-common-native/src/redis-state')

C.configure({
    AUTH_URL: process.env.AUTH_URL,
    credentials: process.env.INTERNAL_CREDS,
})

var app = express()
var port = process.env.PORT || 5000

var bunyanRequest = require('bunyan-request');
app.use(bunyanRequest({
  logger: C.logging.buildBunyan('api'),
  headerName: 'x-request-id'
}));

app.use(function(req, res, next) {
    req.ctx = C.logging.create(req.log)
    next()
})

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({
    extended: false
}))

app.use(function(req, res, next) {
    if (req.body !== undefined)
        req.ctx.trace({ body: req.body }, 'http request body')

    res._json = res.json
    res.json = function(data) {
        req.ctx.trace({ body: data }, 'http response body')
        return res._json.apply(res, arguments)
    }

    next()
})

require('./routes.js')(app)

require('./blueprints.js').router(app)
require('./inventory.js').router(app)
require('./production.js').router(app)

WTF.trace.node.start({ })

worldState.events.once('worldloaded', function() {
    var logger = C.logging.defaultCtx()
    var server = http.createServer(app)

    // TODO implement this configurably
    //server.timeout = 5000
    server.listen(port)

    require('./pubsub.js').setup_websockets(server)

    logger.info("server ready")
})

worldState.subscribe()
