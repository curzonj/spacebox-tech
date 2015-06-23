'use strict';

var http = require("http")
var express = require("express")
var uuidGen = require('node-uuid')
var Q = require('q')
var WTF = require('wtf-shim')
var C = require('spacebox-common')
var swaggerTools = require('swagger-tools');
var urlUtil = require("url")

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

var swaggerDoc = require('../docs/swagger.json');
if (process.env.API_URL) {
    var uri = urlUtil.parse(process.env.API_URL)
    swaggerDoc.host = uri.host
}

swaggerTools.initializeMiddleware(swaggerDoc, function (middleware) {
    // Interpret Swagger resources and attach metadata to request - must be first in swagger-tools middleware chain
    app.use(middleware.swaggerMetadata());

    // Provide the security handlers
    app.use(middleware.swaggerSecurity({
        "swagger-ui-key": function (req, def, api_key, callback) {
            if (api_key) {
                req.headers.authorization = "Bearer " +api_key

                // Ideally in the future endpoints just look for auth here
                req.auth = C.http.authorize_token(api_key, false)
            }

            callback()
        }
    }));

    // Validate Swagger requests
    app.use(middleware.swaggerValidator({
        validateResponse: true
    }));

    // Route validated requests to appropriate controller
    //app.use(middleware.swaggerRouter(options));

    // Serve the Swagger documents and Swagger UI
    app.use(middleware.swaggerUi());

    app.use(function(req, res, next) {
        if (req.body !== undefined)
            req.ctx.trace({ body: req.body }, 'http request body')

        var originalEnd = res.end
        res.end = function(data, encoding) {
            res.end = originalEnd

            var val = data
            if (val instanceof Buffer) {
                val = data.toString(encoding);
            }

            try {
                // Everything SHOULD be sending json
                val = JSON.parse(val)
            } catch(e) {
                // NoOp, swagger will log anything important
            }

            req.ctx.trace({ body: val, status_code: res.statusCode }, 'http response body')

            res.end(data, encoding)
        }

        next()
    })

    require('./routes.js')(app)

    // This only handles synchronous errors. Promise errors
    // still need a promise based error handler
    app.use(function(err, req, res, next) {
        if (err) {
            var dats = { err: err }
            var json = {
                errorDetails: err.toString()
            }

            if (err.originalResponse) {
                if (err.originalResponse instanceof Buffer) {
                    dats.originalResponse = err.originalResponse.toString()
                } else {
                    dats.originalResponse = err.originalResponse
                }
            }
            if (err.results) {
                json.validation = err.results
                dats.results = err.results
            }

            req.ctx.error(dats, 'http error')

            res.status(500).json(json)
        }

        // By not returning the err we show we've handled it
        next()
    })

    WTF.trace.node.start({ })

    worldState.events.once('worldloaded', function() {
        var server = http.createServer(app)

        // TODO implement this configurably
        //server.timeout = 5000
        server.listen(port)
        config.ctx.info("server ready")
    })


    worldState.subscribe()
})
