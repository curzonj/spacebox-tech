'use strict';

require('spacebox-common-native').db_select('tech')

var uuidGen = require('node-uuid'),
    path = require('path'),
    FS = require("q-io/fs"),
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
            return db.one("insert into blueprints (id, tech, parameters, doc) values ($1, $2, $3, $4) returning id", [
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
        return Q.all(blueprints.map(function(d) {
            var bp_type,
                uuid = uuidGen.v1(),
                tech = techs[d.tech]

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
                name: d.name,
                type: bp_type,
                tech_type: tech.type,
                tech_level: 1,
            }

            C.deepMerge(d.parameters, doc)
            C.deepMerge(tech.attributes || {}, doc)

            Object.keys(tech.functions).forEach(function(key) {
                var poly = tech.functions[key]
                console.log(poly)
                console.log(d)
                doc[key] = Math.floor(C.calc_poly({
                    parameters: poly.parameters,
                    components: poly.components
                }, d.parameters))
            })

            doc.build = {
                time: doc.size,
                resources: {
                    "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": doc.size
                }
            }

            if (d.native_modules !== undefined) {
                doc.native_modules = d.native_modules.map(function(query) {
                    var match = C.find(designs, query)
                    return match.uuid
                })
            }

            /* TODO
             * add the resources to the db too
             * vessel subsystems
             */
            designs.push(doc)

            return db.one("insert into blueprints (id, tech, parameters, doc) values ($1, $2, $3, $4) returning id", [
                uuid,
                d.tech,
                d.parameters,
                doc
            ])
        }))
    })
])
}).then(function() {
    console.log('done, exiting')
    process.exit()
}).done()

