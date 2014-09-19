'use strict';

var http = require("http");
var express = require("express");
var logger = require('morgan');
var bodyParser = require('body-parser');
var uuidGen = require('node-uuid');

var app = express();
var port = process.env.PORT || 5000;

app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

var blueprints = require('./blueprints');
for (var uuid in blueprints) {
    blueprints[uuid].uuid = uuid;
}

app.get('/blueprints', function(req, res) {
    res.send(blueprints);
});

app.post('/blueprints', function(req, res) {
    // normally this would have to come from a tech design
    var uuid = uuidGen.v1();
    blueprints[uuid] = req.body;
    res.sendStatus(201);
});

var server = http.createServer(app);
server.listen(port);
console.log("server ready");
