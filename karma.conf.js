module.exports = function (config) {
  config.set({
    basePath: '',

    frameworks: ['mocha', 'chai'],

    files: [
      'test/**/*.js'
    ],

    preprocessors: {
      'test/**/*.js': ['webpack'],
      'lib/**/*': ['webpack']
    },

    webpack: {
      module: {
        loaders: [
          { test: /\.js$/, exclude: /(node_modules|dist)/, loader: 'babel' }
        ]
      }
    },

    reporters: ['mocha'],

    port: 9876,
    colors: true,
    logLevel: config.LOG_INFO,
    autoWatch: false,
    browserNoActivityTimeout: 120000,

    browsers: ['Chrome']
  });
};
