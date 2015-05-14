'use strict';

var http = require("http"),
    express = require("express"),
    logger = require('morgan'),
    bodyParser = require('body-parser'),
    uuidGen = require('node-uuid'),
    Q = require('q'),
    C = require('spacebox-common'),
    db = require('spacebox-common-native').db

db.select('tech')
Q.longStackSupport = true

C.configure({
    AUTH_URL: process.env.AUTH_URL,
    credentials: process.env.INTERNAL_CREDS,
})

var app = express()
var port = process.env.PORT || 5000

app.use(logger('dev'))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: false }))

require('./blueprints.js').router(app)
require('./inventory.js').router(app)
require('./production.js').router(app)

var server = http.createServer(app)
server.listen(port)

require('./pubsub.js').setup_websockets(server)

console.log("server ready")
