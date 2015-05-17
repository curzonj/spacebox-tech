'use strict';

var WebSockets = require("ws"),
    C = require('spacebox-common'),
    uriUtils = require('url')

var listeners = []

module.exports = {
    publish: function (ctx, message) {
        ctx.log('pubsub', "publishing to %d listeners", listeners.length, message)

        listeners.forEach(function(ws) {
            var account = ws.upgradeReq.authentication.account

            if (ws.readyState == WebSockets.OPEN && message.account == account) {
                ws.send(JSON.stringify(message))
            } else {
                ctx.log('pubsub', "owner %s !== connection %s", message.account, account)
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
