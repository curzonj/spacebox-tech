'use strict';

require('../src/db_config')

var uuidGen = require('node-uuid'),
    path = require('path'),
    FS = require("q-io/fs"),
    design_api = require('../src/blueprints'),
    db = require('spacebox-common-native').db,
    C = require('spacebox-common'),
    Q = require('q')

var designs = []

db.tx(function(db) {
return Q.all([
    FS.read(path.resolve(__filename, "../../data/raw_materials.json")).
    then(function (content) {
        return JSON.parse(content)
    }).then(function(content) {
        return Q.all(Object.keys(content).map(function(key) {
            return db.one("insert into blueprints (id, tech, parameters, doc, is_public) values ($1, $2, $3, $4, true) returning id", [
                key,
                'raw_material',
                {},
                C.deepMerge({
                    uuid: key
                }, content[key])
            ])
        }))
    }),

    Q.spread([
        FS.read(path.resolve(__filename, "../../data/design_techs.json")).
            then(function (content) { return JSON.parse(content) }),
        FS.read(path.resolve(__filename, "../../data/public_designs.json")).
            then(function (content) { return JSON.parse(content) })
    ], function(techs, blueprints) {
        return blueprints.reduce(function(next, d) {
            return next.then(function() {
                var doc, list 

                // ATM only the initial public designs have native_modules
                if (d.native_modules !== undefined) {
                    list = d.native_modules.map(function(query) {
                        var match = C.find(designs, query)
                        return match.uuid
                    })
                }

                return design_api.buildNewBlueprint(d, d.parameters, true, list)
            }).then(function(doc) {
                designs.push(doc)
            })
        }, Q(null))
    })
])
}).then(function() {
    console.log('done, exiting')
    process.exit()
}).done()

