'use strict';

var Q = require('q'),
    C = require('spacebox-common')

Q.longStackSupport = true

require('./dao')

module.exports = {
    game: require('../configs/'+process.env.GAME_ENV),
    raw_materials: require('../data/raw_materials'),
    public_designs: require('../data/public_designs'),
    design_techs: require('../data/design_techs'),

    setName: function(name) {
        var ctx = C.logging.create(name)

        C.deepMerge({
            ctx: ctx,
            db: require('spacebox-common-native').db_select('api', ctx),
            state: require('spacebox-common-native/src/redis-state')(ctx),
        }, module.exports)
    }
}

