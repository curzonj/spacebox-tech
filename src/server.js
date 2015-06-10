'use strict';

var http = require("http"),
    express = require("express"),
    morgan = require('morgan'),
    bodyParser = require('body-parser'),
    uuidGen = require('node-uuid'),
    Q = require('q'),
    config = require('./config.js'),
    C = require('spacebox-common')

require('spacebox-common-native').db_select('api')
Q.longStackSupport = true

C.configure({
    AUTH_URL: process.env.AUTH_URL,
    credentials: process.env.INTERNAL_CREDS,
})

var app = express()
var port = process.env.PORT || 5000

var req_id = 0
app.use(function(req, res, next) {
    req_id = req_id + 1
    req.request_id = req_id
    req.ctx = new C.TracingContext()
    req.ctx.prefix.push("req_id=" + req_id)

    next()
});

morgan.token('request_id', function(req, res) {
    return req.request_id
})

app.use(morgan('req_id=:request_id :method :url', {
    immediate: true
}))

app.use(morgan('req_id=:request_id :method :url :status :res[content-length] - :response-time ms'))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({
    extended: false
}))

require('./routes.js')(app)

require('./blueprints.js').router(app)
require('./inventory.js').router(app)
require('./production.js').router(app)

var server = http.createServer(app)
server.listen(port)

require('./pubsub.js').setup_websockets(server)

console.log("server ready")
