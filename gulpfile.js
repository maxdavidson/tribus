var fs = require('fs');

var gulp = require('gulp');
var bump = require('gulp-bump');
var git = require('gulp-git');
var shell = require('gulp-shell');
var watch = require('gulp-watch');
var argv = require('yargs').argv;

gulp.task('link', function () {
  watch(['lib/**/*'], shell.task(['jspm link github:maxdavidson/tribus@master -y']));
});

gulp.task('build', shell.task([
  'jspm bundle-sfx lib/extra/exporter dist/tribus.js',
  'jspm bundle-sfx lib/extra/exporter dist/tribus.min.js --minify --skip-source-maps'
]));

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
