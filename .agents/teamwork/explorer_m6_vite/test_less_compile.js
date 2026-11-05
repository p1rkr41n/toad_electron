const less = require('d:/Shared_UserData/Downloads/tad/tad-master/node_modules/less');
const fs = require('fs');
const path = require('path');

const lessContent = fs.readFileSync('d:/Shared_UserData/Downloads/tad/tad-master/packages/toadviewer/less/tadviewer.less', 'utf8');

// Replace ~ with node_modules path as Vite alias would do
const nodeModulesPath = 'd:/Shared_UserData/Downloads/tad/tad-master/node_modules';

// Custom Less plugin to handle ~ prefix like Vite
class ViteTildePlugin {
  install(lessInstance, pluginManager) {
    const fm = new lessInstance.FileManager();
    fm.supports = function(filename) {
      return filename.startsWith('~') || !filename.startsWith('.');
    };
    fm.loadFile = function(filename, currentDirectory, options, environment) {
      let cleanName = filename.replace(/^~/, '');
      let fullPath = path.join(nodeModulesPath, cleanName);
      if (!fs.existsSync(fullPath)) {
        if (fs.existsSync(fullPath + '.less')) fullPath += '.less';
        else if (fs.existsSync(fullPath + '.css')) fullPath += '.css';
      }
      try {
        const contents = fs.readFileSync(fullPath, 'utf8');
        return Promise.resolve({
          filename: fullPath,
          contents: contents
        });
      } catch (err) {
        return Promise.reject(err);
      }
    };
    pluginManager.addFileManager(fm);
  }
}

less.render(lessContent, {
  javascriptEnabled: true,
  math: 'always',
  plugins: [new ViteTildePlugin()]
}).then(output => {
  console.log('SUCCESS! Rendered CSS byte length:', output.css.length);
}).catch(err => {
  console.error('ERROR rendering less:', err);
});
