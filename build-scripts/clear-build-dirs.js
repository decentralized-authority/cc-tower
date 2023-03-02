const fs = require('fs-extra');
const path = require('path');

(async function() {
  const dirs = [
    path.resolve(__dirname, '../lib'),
    path.resolve(__dirname, '../dist'),
  ];
  for(const dir of dirs) {
    console.log(`Clear ${dir}`);
    await fs.emptydir(dir);
  }
})();
