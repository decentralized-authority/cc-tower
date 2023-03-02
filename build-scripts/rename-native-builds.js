const fs = require('fs-extra');
const path = require('path');

(async function() {
  const buildDir = path.resolve(__dirname, '../dist');
  await fs.move(path.join(buildDir, 'index'), path.join(buildDir, 'cc-gateway'), {overwrite: true});
})();
