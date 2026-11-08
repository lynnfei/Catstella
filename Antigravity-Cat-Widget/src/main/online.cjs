const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { create, releases, releaseUrl, failureReason } = require('../../../shared/online.js');
const { readJson, writeJson } = require('../../../shared/storage.cjs');
const { probeImage } = require('../../../Antigravity-Dream-Skin/src/domain/theme-loader.cjs');

function createOnlineActions({ dataDir, wallpaperDir, characterDir, version, settings, nativeImage, shell, apply,
  onCheck = () => {}, onInstalled = () => {}, fetcher, bundled }) {
  const cache = path.join(dataDir, 'update-check.json');
  const client = create({
    fetcher, bundled,
    loadCheck: () => readJson(cache, null),
    saveCheck: result => { try { writeJson(cache, result); } catch {} }
  });
  async function check(force = false) {
    const result = settings.get('autoUpdateCheck') || force
      ? await client.check('desktop', version, force)
      : { status: 'disabled', current: version, url: releases };
    onCheck(result);
    return result;
  }
  const operations = new Map();
  function validateImage(buffer, mime, limit) {
    const image = probeImage(buffer);
    if (!image?.width || !image.height || image.mime !== mime ||
        image.width * image.height > limit || nativeImage.createFromBuffer(buffer).isEmpty()) throw new Error('invalid image');
  }
  function installCharacter(item, frames) {
    const packId = 'online-' + item.id;
    const images = Object.fromEntries(Object.entries(frames).map(([frame, data]) => {
      const bytes = Buffer.from(data.slice('data:image/png;base64,'.length), 'base64');
      validateImage(bytes, 'image/png', 1_500_000);
      return [frame, bytes];
    }));
    fs.mkdirSync(characterDir, { recursive: true });
    const root = fs.realpathSync(characterDir);
    const dest = path.join(root, packId);
    // 覆盖语义：同目录已存在说明是更新，先清掉旧版再落新文件。
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    const pending = fs.mkdtempSync(path.join(root, '.install-'));
    try {
      const frameDir = path.join(pending, 'frames');
      fs.mkdirSync(frameDir);
      for (const [name, bytes] of Object.entries(images)) fs.writeFileSync(path.join(frameDir, name + '.png'), bytes);
      writeJson(path.join(pending, 'manifest.json'), {
        id: packId, name: item.name, description: item.description, credit: item.credit, revision: item.sha256
      });
      fs.renameSync(pending, dest);
    } finally {
      if (fs.existsSync(pending) && path.dirname(fs.realpathSync(pending)) === root) fs.rmSync(pending, { recursive: true, force: true });
    }
  }
  async function install(id, applyAfterwards) {
    const asset = await client.download(id);
    if (asset.theme) {
      apply({ dreamSkin: { themePreset: asset.theme.palette, opacity: asset.theme.opacity, onlineThemeId: id } });
      return { ok: true, kind: 'theme' };
    }
    if (asset.character) {
      installCharacter(asset.item, asset.character);
      onInstalled('character');
      return { ok: true, kind: 'character' };
    }
    const buffer = Buffer.from(asset.bytes);
    validateImage(buffer, asset.item.mime, 16_000_000);
    const packId = 'online-' + id;
    const dir = path.join(wallpaperDir, packId);
    const filename = 'wallpaper.' + asset.item.path.split('.').pop();
    const file = path.join(dir, filename);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.lstatSync(dir).isDirectory() || fs.realpathSync(dir) !== path.join(fs.realpathSync(wallpaperDir), packId)) throw new Error('invalid wallpaper directory');
    const temp = file + '.' + randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temp, buffer, { flag: 'wx' });
      fs.renameSync(temp, file);
    } finally {
      fs.rmSync(temp, { force: true });
    }
    writeJson(path.join(dir, 'manifest.json'), { id: packId, file: filename, name: asset.item.name, credit: asset.item.credit, revision: asset.item.sha256, pack: asset.item.pack });
    if (applyAfterwards) apply({ dreamSkin: { wallpaperId: packId, wallpaperFile: file } });
    onInstalled('wallpaper');
    return { ok: true, kind: 'wallpaper' };
  }
  // 卸载：按目录名精确移除在线素材，正在使用的角色/壁纸/主题一并回退到内置默认。
  function uninstall(id) {
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/i.test(id)) return { ok: false, reason: 'invalid' };
    const packId = 'online-' + id;
    let kind = null;
    const tryRemove = (baseDir, assign) => {
      try {
        const root = fs.realpathSync(baseDir);
        const target = path.join(root, packId);
        if (fs.existsSync(target) && fs.realpathSync(target) === target) {
          fs.rmSync(target, { recursive: true, force: true });
          assign();
        }
      } catch {}
    };
    tryRemove(characterDir, () => { kind = 'character'; });
    tryRemove(wallpaperDir, () => { if (!kind) kind = 'wallpaper'; });
    if (!kind) {
      const dream = settings.get('dreamSkin') || {};
      if (dream.onlineThemeId === id) kind = 'theme';
    }
    if (!kind) return { ok: false, reason: 'not-installed' };
    const patch = {};
    if (kind === 'character' && settings.get('characterPack') === packId) patch.characterPack = '';
    if (kind === 'wallpaper' && (settings.get('dreamSkin') || {}).wallpaperId === packId) patch.dreamSkin = { wallpaperId: '', wallpaperFile: '' };
    if (kind === 'theme' && (settings.get('dreamSkin') || {}).onlineThemeId === id) patch.dreamSkin = { themePreset: 'violet', onlineThemeId: '' };
    if (Object.keys(patch).length) apply(patch);
    onInstalled(kind);
    return { ok: true, kind };
  }
  async function handle(action, value) {
    try {
      if (action === 'check') return { ok: true, ...(await check(value === true)) };
      if (action === 'release') {
        const result = await check();
        await shell.openExternal(releaseUrl(result.url));
        return { ok: true };
      }
      if (action === 'source' && typeof value === 'string' && (/^https:\/\/www\.bilibili\.com\/video\/BV[a-zA-Z0-9]+\/?$/.test(value) || /^https:\/\/github\.com\/lynnfei\/Catstella\/issues\/new\?/.test(value))) {
        await shell.openExternal(value);
        return { ok: true };
      }
      if (action === 'catalog') {
        const items = await client.list(value === true);
        return { ok: true, items, offline: client.catalogOffline() };
      }
      if (action === 'preview-theme' && typeof value === 'string') {
        const item = (await client.list()).find(item => item.id === value && item.kind === 'theme');
        if (!item) return { ok: false };
        const { theme } = await client.download(item.id);
        return theme ? { ok: true, ...theme } : { ok: false };
      }
      if ((action === 'install' || action === 'download') && typeof value === 'string') {
        if (!operations.has(value)) operations.set(value, install(value, action === 'install').finally(() => operations.delete(value)));
        return await operations.get(value);
      }
      if (action === 'uninstall' && typeof value === 'string') return uninstall(value);
      return { ok: false };
    } catch (error) {
      return { ok: false, reason: failureReason(error) };
    }
  }
  return { check, handle };
}
module.exports = { createOnlineActions };
