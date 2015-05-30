'use strict';

var path = require('path'),
    FS = require("q-io/fs")

module.exports = {
    game: FS.read(path.resolve(__filename, "../../configs/"+process.env.GAME_ENV+".json"))
}
