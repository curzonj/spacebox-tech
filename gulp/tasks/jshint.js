'use strict';

var gulp = require('gulp')
var jshint = require('gulp-jshint')

var packageJSON  = require('../../package'),
    jshintConfig = packageJSON.jshintConfig

jshintConfig.lookup = false

gulp.task('lint', function() {
  return gulp.src('./src/**/*.js')
    .pipe(jshint(jshintConfig))
    .pipe(jshint.reporter('jshint-stylish'))
})
