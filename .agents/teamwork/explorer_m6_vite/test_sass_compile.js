const sass = require('d:/Shared_UserData/Downloads/tad/tad-master/node_modules/sass');
const fs = require('fs');
const path = require('path');

const scssPath = 'd:/Shared_UserData/Downloads/tad/tad-master/packages/toadviewer/src/slickgrid.scss';
const nodeModulesPath = 'd:/Shared_UserData/Downloads/tad/tad-master/node_modules';

try {
  const result = sass.compile(scssPath, {
    importers: [{
      findFileUrl(url) {
        let clean = url.replace(/^~/, '');
        let target = path.join(nodeModulesPath, clean);
        if (fs.existsSync(target)) {
          return new URL('file:///' + target.replace(/\\/g, '/'));
        }
        return null;
      }
    }]
  });
  console.log('SUCCESS! Rendered SCSS byte length:', result.css.length);
} catch (err) {
  console.error('ERROR compiling scss:', err.message);
}
