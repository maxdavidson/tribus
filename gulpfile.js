var fs = require('fs');
var webpack = require("webpack");
var gulp = require('gulp');
var bump = require('gulp-bump');
var git = require('gulp-git');
var shell = require('gulp-shell');
var watch = require('gulp-watch');
var argv = require('yargs').argv;
var eslint = require('gulp-eslint');

gulp.task('build', shell.task([
  'webpack --progress',
  'webpack --progress --config webpack.config.minified.js'
]));

gulp.task('lint', function () {
  return gulp.src(['lib/**/*.js'])
    .pipe(eslint())
    .pipe(eslint.format())
});

gulp.task('bump', function () {
  var type = argv.major ? 'major' : argv.minor ? 'minor' : 'patch';

  return gulp.src('./package.json')
    .pipe(bump({ type: type }))
    .pipe(gulp.dest('./'));
});

gulp.task('tag', ['build'], function () {
  var pkg = JSON.parse(fs.readFileSync('./package.json'));
  var version = 'v' + pkg.version;

  return gulp.src(['./dist/*', './package.json'])
    .pipe(git.add())
    .pipe(git.commit(version))
    .on('end', git.tag.bind(git, version, version));
});
