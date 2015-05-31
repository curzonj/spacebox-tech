'use strict';

var path = require('path'),
    fs = require("fs")

module.exports = {
    game: JSON.parse(fs.readFileSync(path.resolve(__filename, "../../configs/" + process.env.GAME_ENV + ".json")))
}
