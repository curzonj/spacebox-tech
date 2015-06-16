'use strict';

var config = require('./config')

module.exports = function(app) {
    require('./routes/account')(app)
    require('./routes/spawn')(app)
    require('./routes/scanning')(app)
    require('./routes/target')(app)

    app.get('/specs', function(req, res) {
        res.send({
            config: config.game
        })
    })
}
