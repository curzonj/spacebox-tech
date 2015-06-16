'use strict';

var path = require('path'),
    fs = require("fs")

module.exports = {
    game: JSON.parse(fs.readFileSync(path.resolve(__filename, "../../configs/" + process.env.GAME_ENV + ".json"))),
    raw_materials: JSON.parse(fs.readFileSync(path.resolve(__filename, "../../data/raw_materials.json"))),
    public_designs: JSON.parse(fs.readFileSync(path.resolve(__filename, "../../data/public_designs.json"))),
    design_techs: JSON.parse(fs.readFileSync(path.resolve(__filename, "../../data/design_techs.json"))),
    tick_wait: parseInt(process.env.TICK_WAIT),
}
