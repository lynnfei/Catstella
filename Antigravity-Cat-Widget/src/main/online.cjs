const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { create, releases, releaseUrl, failureReason } = require('../../../shared/online.js');
const { readJson, writeJson } = require('../../../shared/storage.cjs');
const { probeImage } = require('../../../Antigravity-Dream-Skin/src/domain/theme-loader.cjs');

function createOnlineActions({ dataDir, wallpaperDir, characterDir, version, settings, nativeImage, shell, apply,
  getDreamSkin = () => settings.get('dreamSkin') || {}, getFallbackWallpaper = () => null,
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
  let mutationQueue = Promise.resolve();
  function mutate(key, task) {
    if (!operations.has(key)) {
      const pending = mutationQueue.then(task).finally(() => operations.delete(key));
      operations.set(key, pending);
      mutationQueue = pending.catch(() => {});
    }
    return operations.get(key);
  }
  function assetDirectory(baseDir, packId) {
    fs.mkdirSync(baseDir, { recursive: true });
    const root = fs.realpathSync(baseDir), dest = path.join(root, packId);
    if (fs.existsSync(dest) && (fs.lstatSync(dest).isSymbolicLink() || !fs.lstatSync(dest).isDirectory() || fs.realpathSync(dest) !== dest)) throw new Error('invalid asset directory');
    return { root, dest };
  }
  function replaceAsset(baseDir, packId, write) {
    const { root, dest } = assetDirectory(baseDir, packId);
    const pending = fs.mkdtempSync(path.join(root, '.install-'));
    const backup = path.join(root, '.replace-' + randomUUID());
    let moved = false;
    try {
      write(pending);
      if (fs.existsSync(dest)) { fs.renameSync(dest, backup); moved = true; }
      try { fs.renameSync(pending, dest); }
      catch (error) { if (moved) { fs.renameSync(backup, dest); moved = false; } throw error; }
    } finally {
      if (fs.existsSync(pending)) fs.rmSync(pending, { recursive: true, force: true });
    }
    // A locked obsolete file must not turn an otherwise complete update into failure.
    if (moved) try { fs.rmSync(backup, { recursive: true, force: true }); } catch {}
  }
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
    replaceAsset(characterDir, packId, pending => {
      const frameDir = path.join(pending, 'frames');
      fs.mkdirSync(frameDir);
      for (const [name, bytes] of Object.entries(images)) fs.writeFileSync(path.join(frameDir, name + '.png'), bytes);
      writeJson(path.join(pending, 'manifest.json'), {
        id: packId, name: item.name, description: item.description, credit: item.credit, revision: item.sha256
      });
    });
  }
  async function install(id, applyAfterwards) {
    const asset = await client.download(id);
    if (asset.theme) {
      apply({ dreamSkin: { themePreset: asset.theme.palette, opacity: asset.theme.opacity, onlineThemeId: id, onlineThemeRevision: asset.item.sha256 } });
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
    replaceAsset(wallpaperDir, packId, pending => {
      fs.writeFileSync(path.join(pending, filename), buffer);
      writeJson(path.join(pending, 'manifest.json'), { id: packId, file: filename, name: asset.item.name, credit: asset.item.credit, revision: asset.item.sha256, pack: asset.item.pack });
    });
    onInstalled('wallpaper');
    if (applyAfterwards || getDreamSkin().wallpaperId === packId) apply({ dreamSkin: { wallpaperId: packId, wallpaperFile: file } });
    return { ok: true, kind: 'wallpaper' };
  }
  // 卸载：按目录名精确移除在线素材，正在使用的角色/壁纸/主题一并回退到内置默认。
  function uninstall(id) {
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/i.test(id)) return { ok: false, reason: 'invalid' };
    const packId = 'online-' + id;
    let kind = null, location;
    for (const [candidate, base] of [['character', characterDir], ['wallpaper', wallpaperDir]]) {
      if (!fs.existsSync(base)) continue;
      const checked = assetDirectory(base, packId);
      if (fs.existsSync(checked.dest)) { kind = candidate; location = checked; break; }
    }
    const dream = getDreamSkin();
    if (!kind && dream.onlineThemeId === id) kind = 'theme';
    if (!kind) return { ok: false, reason: 'not-installed' };
    const patch = {};
    if (kind === 'character' && settings.get('characterPack') === packId) patch.characterPack = 'gemini-star-v1';
    if (kind === 'wallpaper' && (dream.wallpaperId === packId || location && dream.wallpaperFile && path.dirname(path.resolve(dream.wallpaperFile)) === location.dest)) {
      const fallback = getFallbackWallpaper();
      patch.dreamSkin = { wallpaperId: fallback?.id || 'gemini-character-sheet-v1', wallpaperFile: fallback?.file || '' };
    }
    if (kind === 'theme') patch.dreamSkin = { themePreset: 'violet', opacity: 55, onlineThemeId: '', onlineThemeRevision: '' };
    // Persist a valid replacement before removing an in-use asset. A failed save keeps its files intact.
    if (Object.keys(patch).length) apply(patch);
    if (location) fs.rmSync(location.dest, { recursive: true, force: true });
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
        return await mutate(action + ':' + value, () => install(value, action === 'install'));
      }
      if (action === 'uninstall' && typeof value === 'string') return await mutate('uninstall:' + value, () => uninstall(value));
      return { ok: false };
    } catch (error) {
      return { ok: false, reason: failureReason(error) };
    }
  }
  return { check, handle };
}
module.exports = { createOnlineActions };
