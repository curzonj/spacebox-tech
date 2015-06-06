'use strict';

var gulp = require('gulp');
var jscs = require('gulp-jscs');
var jshint = require('gulp-jshint');

// For windows users setup a growl notifier
//var growlNotifier = growl();
var packageJSON  = require('../../package'),
    config = packageJSON.jscsConfig;

gulp.task('style', function() {
    gulp.src('./src/**/*.js')
        .pipe(jscs(config))
})
