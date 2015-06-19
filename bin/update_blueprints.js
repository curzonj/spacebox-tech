#!/usr/bin/env node

'use strict';

var uuidGen = require('node-uuid'),
    path = require('path'),
    fs = require("fs"),
    C = require('spacebox-common'),
    Q = require('q')

var config = require('../src/config')
config.setName('update_blueprints')

var design_api = require('../src/blueprints')
var db = config.db

function updateBlueprint(db, row) {
    var tech = config.design_techs[row.tech]
    design_api.calculateBlueprintValues(tech, row.doc, row.parameters)

    return db.none("update blueprints set doc = $2 where id = $1", [ row.id, row.doc ])
}

db.tx(function(db) {
    return Q.fcall(function() {
        return db.many("select * from blueprints where tech != 'raw_material'").
        then(function(rows) {
            return Q.all(rows.map(function(row) {
                updateBlueprint(db, row)
            }))
        })
    }).then(function() {
        return Q.all(config.public_designs.map(function(d) {
            return db.oneOrNone("select * from blueprints where tech = $1 and is_public = true and doc::json->>'name' = $2", [ d.tech, d.name ]).
            then(function(row) {
                if (row === null) {
                    return design_api.buildNewBlueprint(d, d.parameters, true)
                } else {
                    C.deepMerge(d.parameters, row.parameters)
                    return updateBlueprint(db, row)
                }
            })
        }))
    }).then(function() {
        return Object.keys(config.raw_materials).map(function(key) {
            var doc = config.raw_materials[key]
            return db.oneOrNone('select * from blueprints where id = $1', key).
            then(function(row) {
                if (row === null) {
                    return db.one("insert into blueprints (id, tech, parameters, doc, is_public) values ($1, $2, $3, $4, true) returning id",
                                  [ key, 'raw_material', {}, doc ])
                } else {
                    return db.none("update blueprints set doc = $2 where id = $1", [ key, doc ])
                }
            
            })
        })
    })
}).then(function() {
    console.log('done, exiting')
    process.exit()
}).done()

