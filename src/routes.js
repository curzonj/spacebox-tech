'use strict';

var config = require('./config')

module.exports = function(app) {
    require('./routes/account')(app)
    require('./routes/spawn')(app)
    require('./routes/scanning')(app)
    require('./routes/target')(app)

    require('./blueprints.js').router(app)
    require('./inventory.js').router(app)
    require('./production.js').router(app)

    app.get('/specs', function(req, res) {
        res.json({
            config: config.game,
            raw_materials: config.raw_materials,
            public_designs: config.public_designs,
        })
    })
}
