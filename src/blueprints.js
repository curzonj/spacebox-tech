'use strict';

var uuidGen = require('node-uuid'),
    path = require('path'),
    FS = require("q-io/fs"),
    db = require('spacebox-common-native').db,
    C = require('spacebox-common'),
    Q = require('q')

var techs_data = FS.read(path.resolve(__filename, "../../data/design_techs.json")).
    then(function (content) { return JSON.parse(content) })

function buildBigList(rows) {
    return rows.reduce(function(acc, row) {
        acc[row.id] = row.doc
        return acc
    }, {})
}

var self = module.exports = {
    router: function(app) {
        app.get('/techs/:name', function(req, res) {
            Q.spread([C.http.authorize_req(req), techs_data], function(auth, techs) {
                var tech = techs[req.param('name')]
                if (tech === undefined)
                    return res.sendStatus(404)

                res.send(tech)
            }).fail(C.http.errHandler(req, res, console.log)).done()
        })

        app.get('/blueprints/:uuid', function(req, res) {
            C.http.authorize_req(req).then(function(auth) {
                var query,
                    uuid = req.param('uuid')

                C.assertUUID(uuid)

                if (auth.privileged === true) {
                    query = db.one("select * from blueprints where id = $1", uuid)
                } else {
                    query = db.one("select * from blueprints where id in (select blueprint_id from blueprint_perms where account_id = $1) or blueprints.is_public = true and id = $2", [ auth.account, uuid ])
                }

                return query.then(function(row) {
                    res.send(row.doc);
                })
            }).fail(C.http.errHandler(req, res, console.log)).done()
        });

        app.get('/blueprints', function(req, res) {
            C.http.authorize_req(req).then(function(auth) {
                var list
                if (auth.privileged === true) {
                    list = db.many("select * from blueprints")
                } else {
                    list = db.many("select * from blueprints where id in (select blueprint_id from blueprint_perms where account_id = $1) or blueprints.is_public = true", auth.account)
                }

                return list.then(buildBigList).
                then(function(blueprints) {
                    res.send(blueprints);
                })
            }).fail(C.http.errHandler(req, res, console.log)).done()
        });
    }
}
