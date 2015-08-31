module.exports = {
  entry: './main.js',
  
  output: {
    filename: 'bundle.js' 
  },

  //devtool: "inline-source-map",

  module: {
    loaders: [
      { test: /\.js$/, exclude: /node_modules/, loader: 'babel' }
    ]
  }
};
