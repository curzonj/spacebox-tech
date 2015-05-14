'use strict';

var WebSockets = require("ws"),
    npm_debug = require('debug'),
    log = npm_debug('build:info'),
    error = npm_debug('build:error'),
    debug = npm_debug('build:debug'),
    C = require('spacebox-common'),
    uriUtils = require('url')

var listeners = []

module.exports = {
    publish: function (message) {
        log("publishing to %d listeners", listeners.length, message)

        listeners.forEach(function(ws) {
            var account = ws.upgradeReq.authentication.account

            if (ws.readyState == WebSockets.OPEN && message.account == account) {
                ws.send(JSON.stringify(message))
            } else {
                error("owner %s !== connection %s", message.account, account)
            }
        })
    },
    setup_websockets: function(server) {
        var wss = new WebSockets.Server({
            server: server,
            verifyClient: function (info, callback) {
                var parts = uriUtils.parse(info.req.url, true)
                var token = parts.query.token

                C.http.authorize_token(token).then(function(auth) {
                    info.req.authentication = auth
                    callback(true)
                }, function(e) {
                    callback(false)
                })
            }
        })

        wss.on('connection', function(ws) {
            listeners.push(ws)

            ws.on('close', function() {
                var i= listeners.indexOf(ws)
                if (i > -1) {
                    listeners.splice(i, 1)
                }
            })
        })
    }
}
