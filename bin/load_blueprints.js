'use strict';

var Q = require('q')
var C = require('spacebox-common')
var uuidGen = require('node-uuid')

var config = require('../src/config')
config.setName('load_blueprints')

var db = config.db
var raw_materials = config.raw_materials
var public_designs = config.public_designs
var design_api = require('../src/blueprints')

var designs = []

db.tx(function(db) {
return Q.all([
    Q.all(Object.keys(raw_materials).map(function(key) {
        return db.one("insert into blueprints (id, tech, parameters, doc, is_public) values ($1, $2, $3, $4, true) returning id", [
            key,
            'raw_material',
            {},
            C.deepMerge({
                uuid: key
            }, raw_materials[key])
        ])
    })),

    public_designs.reduce(function(next, d) {
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
])
}).then(function() {
    console.log('done, exiting')
    process.exit()
}).done()

