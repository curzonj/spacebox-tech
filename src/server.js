'use strict';

var http = require("http")
var express = require("express")
var uuidGen = require('node-uuid')
var bodyParser = require('body-parser')
var Q = require('q')
var WTF = require('wtf-shim')
var C = require('spacebox-common')
var swaggerTools = require('swagger-tools');
var urlUtil = require("url")

var config = require('./config')
config.setName('api')

var worldState = config.state
var db = config.db

var app = express()
var port = process.env.PORT || 5000

var bunyanRequest = require('bunyan-request');
app.use(bunyanRequest({
  logger: config.ctx,
  headerName: 'x-request-id'
}));

app.use(function(req, res, next) {
    req.ctx = req.log
    req.db = db.tracing(req.ctx)

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

    // Serve the Swagger documents and Swagger UI unauthenticated
    app.use(middleware.swaggerUi());

    // Provide the security handlers
    app.use(middleware.swaggerSecurity({
        "swagger-ui-key": function (req, def, api_key, callback) {
            if (api_key)
                req.headers.authorization = "Bearer " +api_key

            callback()
        }
    }));

    app.use(function(req, res, next) {
        //console.log(req.swagger)

        // We ignore the specifics atm about what security
        // is required. We also authenticate anything not
        // specified by swagger. Secure by default.
        if (req.swagger && req.swagger.security && req.swagger.security.length === 0)
            return next()

        C.http.authorize_req(req).
        then(function(auth) {
            req.auth = auth
            next()
        }, function(err) {
            req.ctx.error({ err: err }, 'authentication failed')
            next(err)
        }).done()
    })

    // Validate Swagger requests
    app.use(middleware.swaggerValidator({
        validateResponse: true
    }));

    // Route validated requests to appropriate controller
    //app.use(middleware.swaggerRouter(options));

    // Not all endpoints use swagger yet
    app.use(bodyParser.json())
    app.use(bodyParser.urlencoded({
        extended: false
    }))

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

    app.use(function(req, res, next) {
        if (!req.body.wait_ts)
            return next()

        worldState.waitForTick(req.ctx, req.body.wait_ts, config.tick_wait).
        then(function() {
            next()
        }).fail(next).done()
    })

    require('./routes.js')(app)

    // This only handles synchronous errors. Promise errors
    // still need a promise based error handler
    app.use(function(err, req, res, next) {
        if (err) {
            var dats = { err: err }
            var status = 500
            var json = {
                errorDetails: err.toString()
            }

            if (err.originalResponse)
                if (err.originalResponse instanceof Buffer) {
                    dats.originalResponse = err.originalResponse.toString()
                } else {
                    dats.originalResponse = err.originalResponse
                }

            if (err.results)
                json.validation = dats.results = err.results

            req.ctx.error(dats, 'http error')

            if (C.isA(err, "HttpError")) {
                status = err.status || 500
                json.errorCode = err.msgCode
                json.errorDetails = err.details
            }

            res.status(status).json(json)
        }

        // By not returning the err we show we've handled it
        next()
    })

    WTF.trace.node.start({ })

    worldState.events.once('worldloaded', function() {
        var server = http.createServer(app)

        server.timeout = parseInt(process.env.REQUEST_TIMEOUT) || 5000
        server.listen(port)
        config.ctx.info("server ready")
    })


    worldState.subscribe()
})
