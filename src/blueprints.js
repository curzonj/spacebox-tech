'use strict';

var uuidGen = require('node-uuid'),
    path = require('path'),
    FS = require("q-io/fs"),
    db = require('spacebox-common-native').db,
    C = require('spacebox-common'),
    Q = require('q')

var self = module.exports = {
    getData: function() {
        return db.many("select * from blueprints").
        then(function(data) {
            return data.reduce(function(acc, row) {
                acc[row.id] = row.doc
                return acc
            }, {})
        })
    },
    router: function(app) {
        app.get('/blueprints', function(req, res) {
            //  TODO support account specific blueprints
            self.getData().then(function(blueprints) {
                res.send(blueprints);
            }).fail(C.http.errHandler(req, res, console.log)).done()
        });
    }
}
