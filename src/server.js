'use strict';

var http = require("http")
var express = require("express")
var bodyParser = require('body-parser')
var uuidGen = require('node-uuid')
var Q = require('q')
var WTF = require('wtf-shim')
var C = require('spacebox-common')

var config = require('./config')
config.setName('api')

var worldState = config.state

var app = express()
var port = process.env.PORT || 5000

var bunyanRequest = require('bunyan-request');
app.use(bunyanRequest({
  logger: config.ctx,
  headerName: 'x-request-id'
}));

app.use(function(req, res, next) {
    req.ctx = req.log
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
    var server = http.createServer(app)

    // TODO implement this configurably
    //server.timeout = 5000
    server.listen(port)

    require('./pubsub.js').setup_websockets(server)

    config.ctx.info("server ready")
})

worldState.subscribe()
