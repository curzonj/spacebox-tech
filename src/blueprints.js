'use strict';

var uuidGen = require('node-uuid'),
    path = require('path'),
    fs = require("fs"),
    db = require('spacebox-common-native').db,
    C = require('spacebox-common'),
    Q = require('q')


function buildBigList(rows) {
    return rows.reduce(function(acc, row) {
        acc[row.id] = row.doc
        return acc
    }, {})
}

var self = module.exports = {
    techs_data: JSON.parse(fs.readFileSync(path.resolve(__filename, "../../data/design_techs.json"))),
    buildNewBlueprint: function(parent, parameters, native_modules) {
        var bp_type,
            d = parent,
            uuid = uuidGen.v1(),
            tech = self.techs_data[d.tech]

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
            tech: d.tech,
            tech_type: tech.type,
            tech_level: 1,
        }

        C.deepMerge(parameters, doc)
        C.deepMerge(tech.attributes || {}, doc)

        Object.keys(tech.functions).forEach(function(key) {
            var poly = tech.functions[key]
            //console.log(poly)
            //console.log(d)
            doc[key] = Math.floor(C.calc_poly({
                parameters: poly.parameters,
                components: poly.components
            }, parameters))
        })

        doc.build = {
            time: doc.size,
            resources: {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": doc.size
            }
        }

        if (native_modules !== undefined)
            doc.native_modules = native_modules

        return db.one("insert into blueprints (id, tech, parameters, doc, is_public) values ($1, $2, $3, $4, true) returning id", [
            uuid,
            d.tech,
            parameters,
            doc
        ]).then(function() {
            return doc
        })
    },
    router: function(app) {
        app.get('/techs/:name', function(req, res) {
            C.http.authorize_req(req).then(function(auth) {
                var tech = self.techs_dat[req.param('name')]
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
                    query = db.one("select * from blueprints where id in (select blueprint_id from blueprint_perms where account_id = $1) or blueprints.is_public = true and id = $2", [auth.account, uuid])
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
