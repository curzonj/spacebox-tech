'use strict';

var uuidGen = require('node-uuid')
var path = require('path')
var fs = require("fs")
var C = require('spacebox-common')
var Q = require('q')

var config = require('./config')
var worldState = config.state
var db = config.db

function buildBigList(rows) {
    return rows.reduce(function(acc, row) {
        acc[row.id] = row.doc
        return acc
    }, {})
}

var self = module.exports = {
    determineBuildResources: function(input_params) {
        var time = Math.floor(C.calc_poly({
            parameters: config.game.build_time.parameters,
            components: config.game.build_time.components
        }, input_params))

        var amount = Math.floor(C.calc_poly({
            parameters: config.game.build_resources.parameters,
            components: config.game.build_resources.components
        }, input_params))

        return {
            time: time,
            resources: {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": amount,
            }
        }
    },
    updateVesselBlueprint: function(uuid, blueprint) {
        var new_obj = JSON.parse(JSON.stringify(blueprint))
        new_obj.blueprint = blueprint.uuid
        delete new_obj.uuid

        // TODO what happens to it's health
        // TODO what about changes to modules?

        return worldState.queueChangeIn(uuid, new_obj)
    },
    calculateBlueprintValues: function(tech, doc, parameters) {
        var input_params = C.deepMerge(parameters, 
            C.deepMerge(config.game.global_parameters, {
                tech_level: 1,
            }))

        Object.keys(tech.functions).forEach(function(key) {
            var poly = tech.functions[key]
            //console.log(poly)
            //console.log(d)
            var value = Math.floor(C.calc_poly({
                parameters: poly.parameters,
                components: poly.components
            }, input_params))

            doc[key] = value
            input_params[key] = value
        })

        doc.build = self.determineBuildResources(input_params)
    },
    updateBlueprintDoc: function(db, row) {
        var tech = config.design_techs[row.tech]

        C.deepMerge(row.parameters, row.doc)
        C.deepMerge(tech.attributes || {}, row.doc)

        self.calculateBlueprintValues(tech, row.doc, row.parameters)

        return db.none("update blueprints set doc = $2, parameters = $3 where id = $1", [ row.id, row.doc, row.parameters ])
    
    },
    buildNewBlueprint: function(parent, parameters, is_public, native_modules) {
        var bp_type,
            d = parent,
            uuid = uuidGen.v1(),
            tech = config.design_techs[d.tech]

        switch(d.tech) {
            case 'spaceship':
            case 'structure':
                bp_type = 'vessel'
                break;
            default:
                bp_type = 'module'
        }

        var doc = {
            uuid: uuid,
            type: bp_type,
            tech: d.tech,
            tech_type: tech.type,
        }

        if (is_public)
            doc.name = d.name

        C.deepMerge(parameters, doc)
        C.deepMerge(tech.attributes || {}, doc)

        self.calculateBlueprintValues(tech, doc, parameters)

        if (native_modules !== undefined)
            doc.native_modules = native_modules

        return db.none("insert into blueprints (id, tech, parameters, doc, is_public) values ($1, $2, $3, $4, $5)", [
            uuid,
            d.tech,
            parameters,
            doc,
            (is_public === true)
        ]).then(function() {
            return doc
        })
    },
    router: function(app) {
        app.get('/techs/:name', function(req, res) {
            C.http.authorize_req(req).then(function(auth) {
                var tech = config.design_techs[req.param('name')]
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
                    query = db.one("select * from blueprints where id in (select blueprint_id from blueprint_perms where agent_id = $1) or blueprints.is_public = true and id = $2", [auth.agent_id, uuid])
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
                    list = db.many("select * from blueprints where id in (select blueprint_id from blueprint_perms where agent_id = $1) or blueprints.is_public = true", auth.agent_id)
                }

                return list.then(buildBigList).
                then(function(blueprints) {
                    res.send(blueprints);
                })
            }).fail(C.http.errHandler(req, res, console.log)).done()
        });
    }
}
