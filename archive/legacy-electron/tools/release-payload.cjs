const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function stripByokUi(app) {
  const files = ['main/preload.cjs', 'renderer/index.html', 'renderer/renderer.cjs',
    'renderer/settings.html', 'renderer/settings.cjs', 'renderer/settings.css'];
  for (const relative of files) {
    const file = path.join(app, 'Antigravity-Cat-Widget/src', relative);
    const original = fs.readFileSync(file, 'utf8');
    const block = /^(?:\/\*|<!--) @byok-dev-start (?:\*\/|-->)\r?\n[\s\S]*?^(?:\/\*|<!--) @byok-dev-end (?:\*\/|-->)\r?\n/gm;
    const staged = original.replace(block, '');
    if (staged === original || staged.includes('@byok-dev-')) throw Error('Invalid BYOK release boundary in ' + relative);
    if (relative.endsWith('.cjs')) new vm.Script(staged, { filename: relative });
    fs.writeFileSync(file, staged);
  }
}

// electron-builder calls this after copying the app and before macOS signing.
exports.default = ({ appOutDir, electronPlatformName, packager }) => {
  const resources = electronPlatformName === 'darwin'
    ? path.join(appOutDir, packager.appInfo.productFilename + '.app', 'Contents', 'Resources')
    : path.join(appOutDir, 'resources');
  stripByokUi(path.join(resources, 'app'));
};
exports.stripByokUi = stripByokUi;
