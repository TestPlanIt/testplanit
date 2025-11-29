// webpack.config.js
const path = require('path');

module.exports = {
  resolve: {
    alias: {
      'yjs': path.resolve(__dirname, 'node_modules/yjs')
    }
  }
};
