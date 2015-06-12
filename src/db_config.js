'use strict';

var Q = require('q'),
    C = require('spacebox-common')

C.logging.configure('api')
Q.longStackSupport = true

require('./dao')
require('spacebox-common-native').db_select('api')
