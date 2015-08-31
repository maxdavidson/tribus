var webpack = require("webpack");

module.exports = {
  entry: "./lib/tribus.js",
  
  output: {
    libraryTarget: "umd",
    library: "Tribus",
    path: "./dist",
    filename: "tribus.min.js"
  },
  
  plugins: [
    new webpack.optimize.UglifyJsPlugin({}),
    new webpack.optimize.OccurenceOrderPlugin(true)
  ],
  
  module: {
    loaders: [
      { test: /\.js$/, include: /lib/, loader: 'babel' }
    ]
  }
};
