const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('cold start paints only the persisted character after artwork decoding', () => {
  const html = read('src/renderer/index.html');
  const css = read('src/renderer/widget.css');
  const renderer = read('src/renderer/renderer.cjs');
  const preload = read('src/main/preload.cjs');
  const main = read('src/main/index.cjs');

  assert.doesNotMatch(html, /<img[^>]+(?:agy-frame|agy-expression)[^>]+src=/);
  assert.match(html, /data-art-ready="false"/);
  assert.match(css, /\.agy-art:not\(\[data-art-ready="true"\]\) \.agy-face\{visibility:hidden\}/);
  assert.match(renderer, /await Promise\.all\(images\.map/);
  assert.match(renderer, /api\.ready\(\)/);
  assert.match(preload, /ready:\(\)=>ipcRenderer\.send\("widget:ready"\)/);
  assert.match(main, /ipcMain\.on\("widget:ready"/);
  assert.doesNotMatch(main, /ready-to-show",show/);
});
