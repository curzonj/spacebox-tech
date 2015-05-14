'use strict';

var uuidGen = require('node-uuid'),
    Q = require('q')

var blueprints = require('./blueprint_demo.js');
for (var uuid in blueprints) {
    blueprints[uuid].uuid = uuid;
}

module.exports = {
    getData: function() {
        return Q(blueprints)
    },
    router: function(app) {
        app.get('/blueprints', function(req, res) {
            res.send(blueprints);
        });

        app.post('/blueprints', function(req, res) {
            // normally this would have to come from a tech design
            var uuid = uuidGen.v1();
            blueprints[uuid] = req.body;
            res.sendStatus(201);
        });
    }
}
