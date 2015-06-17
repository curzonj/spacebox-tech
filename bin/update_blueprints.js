#!/usr/bin/env node

'use strict';

var uuidGen = require('node-uuid'),
    path = require('path'),
    fs = require("fs"),
    C = require('spacebox-common'),
    Q = require('q')

C.logging.configure('load_blueprints')
require('../src/db_config')

var design_api = require('../src/blueprints')
var config = require('../src/config')
var db = require('spacebox-common-native').db

db.tx(function(db) {
    return db.many("select * from blueprints where tech != 'raw_material'").
    then(function(rows) {
        return Q.all(rows.map(function(row) {
            var tech = config.design_techs[row.tech]
            design_api.calculateBlueprintValues(tech, row.doc, row.parameters)

            return db.none("update blueprints set doc = $2 where id = $1", [ row.id, row.doc ])
        }))
    })
}).then(function() {
    console.log('done, exiting')
    process.exit()
}).done()

