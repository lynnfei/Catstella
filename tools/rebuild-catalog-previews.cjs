const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { catalog } = require('../shared/online.js');

async function rebuild() {
  const root = path.resolve(__dirname, '..');
  const catalogPath = path.join(root, 'online-assets', 'catalog.json');
  const data = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

  // 1. Rebuild wallpaper previews (540px width, quality 80)
  for (const item of data.items) {
    if (item.kind !== 'wallpaper') continue;
    const filePath = path.join(root, 'online-assets', item.path);
    if (!fs.existsSync(filePath)) throw new Error('Missing wallpaper file: ' + filePath);
    const buf = await sharp(filePath)
      .resize({ width: 540, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    item.preview = 'data:image/webp;base64,' + buf.toString('base64');
    console.log(`Generated wallpaper preview: ${item.id} (${buf.length} bytes, base64: ${item.preview.length})`);
  }

  // 2. Rebuild character previews (384x384px, quality 80)
  for (const char of data.characters || []) {
    const idlePath = path.join(root, 'Antigravity-Cat-Widget', 'assets', 'character-packs', char.id, 'frames', 'idle.png');
    if (!fs.existsSync(idlePath)) throw new Error('Missing character idle frame: ' + idlePath);
    const buf = await sharp(idlePath)
      .resize({ width: 384, height: 384, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 80 })
      .toBuffer();
    char.preview = 'data:image/webp;base64,' + buf.toString('base64');
    console.log(`Generated character preview: ${char.id} (${buf.length} bytes, base64: ${char.preview.length})`);
  }

  // 3. Verify with shared/online.js
  const verified = catalog(data);
  console.log(`Verified ${verified.length} catalog items successfully.`);

  fs.writeFileSync(catalogPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('Saved catalog.json successfully.');
}

rebuild().catch(err => {
  console.error(err);
  process.exit(1);
});
