var webpack = require("webpack");

module.exports = {
  entry: './lib/tribus.js',

  output: {
    libraryTarget: 'umd',
    library: 'Tribus',
    path: './dist',
    filename: 'tribus.js' 
  },

  debug: true,
  
  devtool: "source-map",
  
  plugins: [
    new webpack.optimize.OccurenceOrderPlugin(true)
  ],

  module: {
    loaders: [
        { test: /\.js$/, include: /lib/, loader: 'babel' },
        { test: /\.js$/, include: /node_modules/, loader: 'source-map-loader' }
    ],
    preLoaders: [
        { test: /\.js$/, exclude: /node_modules/, loader: "eslint-loader"}
    ]
  }
};
