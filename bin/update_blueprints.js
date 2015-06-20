#!/usr/bin/env node

'use strict';

var uuidGen = require('node-uuid')
var path = require('path')
var fs = require("fs")
var C = require('spacebox-common')
var Q = require('q')
var async = require('async-q')

var config = require('../src/config')
config.setName('update_blueprints')
var db = config.db
var ctx = config.ctx

var design_api = require('../src/blueprints')
var inventory = require('../src/inventory')

Q.fcall(function() {
    return async.every(
        db.many("select * from blueprints where tech != 'raw_material'"),
        function(row) {
            design_api.updateBlueprintDoc(db, row)
        })
}).then(function() {
    return async.every(config.public_designs,
    function(d) {
        return db.oneOrNone("select * from blueprints where tech = $1 and is_public = true and doc::json->>'name' = $2", [ d.tech, d.name ]).
        then(function(row) {
            if (row === null) {
                return design_api.buildNewBlueprint(d, d.parameters, true)
            } else {
                ctx.trace({ parameters: d.parameters, current: row }, 'updating blueprint')
                C.deepMerge(d.parameters, row.parameters)

                return design_api.updateBlueprintDoc(db, row)
            }
        })
    })
}).then(function() {
    return async.every(Object.keys(config.raw_materials),
    function(key) {
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
}).then(function() {
    return async.each(
        // TODO use https://github.com/brianc/node-pg-cursor
        db.many('select id from inventories'),
        function(id_row) {
            return db.tx(function(db) {
                return db.inventory.getForUpdate(id_row.id).
                then(C.qAppend(function(container) {
                    return db.blueprints.get(container.doc.blueprint)
                })).spread(function(container, blueprint) {
                    return inventory.updateContainer(ctx, container, blueprint, db).
                    then(function() {
                        return inventory.recalculateCargoUsage(ctx, container, db)
                    })
                })
            })
        }
    )
}).then(function() {
    console.log('done, exiting')
    process.exit()
}).done()

