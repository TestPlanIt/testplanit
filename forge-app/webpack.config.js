const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

// Common module rules
const moduleRules = {
  rules: [
    {
      test: /\.(js|jsx)$/,
      exclude: /node_modules/,
      use: {
        loader: 'babel-loader',
        options: {
          presets: ['@babel/preset-env', '@babel/preset-react'],
        },
      },
    },
    {
      test: /\.css$/i,
      use: [MiniCssExtractPlugin.loader, 'css-loader', 'postcss-loader'],
    },
  ],
};

// Export multiple configurations for different entry points
module.exports = [
  // Frontend configuration (issue panel)
  {
    mode: 'production',
    entry: './src/frontend/app.jsx',
    output: {
      path: path.resolve(__dirname, 'static/frontend'),
      filename: 'app.js',
      clean: true,
    },
    module: moduleRules,
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/frontend/index.html',
        filename: 'index.html',
      }),
      new MiniCssExtractPlugin({
        filename: 'app.css',
      }),
    ],
    resolve: {
      extensions: ['.js', '.jsx'],
    },
  },
  // Settings configuration (admin page)
  {
    mode: 'production',
    entry: './src/frontend/settings.jsx',
    output: {
      path: path.resolve(__dirname, 'static/settings'),
      filename: 'settings.js',
      clean: true,
    },
    module: moduleRules,
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/frontend/index.html',
        filename: 'index.html',
      }),
      new MiniCssExtractPlugin({
        filename: 'settings.css',
      }),
    ],
    resolve: {
      extensions: ['.js', '.jsx'],
    },
  },
];