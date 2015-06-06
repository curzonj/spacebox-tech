var gulp = require('gulp');
var prettify = require('gulp-jsbeautifier');

gulp.task('git-pre-js', function() {
  gulp.src('./src/**/*.js')
    .pipe(prettify({config: '.jsbeautifyrc', mode: 'VERIFY_ONLY'}))
});

gulp.task('format-js', function() {
  gulp.src(['./src/**/*.js'], { base: './' })
    .pipe(prettify({config: '.jsbeautifyrc', mode: 'VERIFY_AND_WRITE'}))
    .pipe(gulp.dest('./'))
});
