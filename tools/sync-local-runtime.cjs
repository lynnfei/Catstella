// Refresh an existing local test installation without rebuilding the installer
// or replacing its browser extension directory (and therefore its browser ID).
const fs = require('node:fs');
const path = require('node:path');
const { stripByokUi } = require('./release-payload.cjs');
const { detectWebCompanion } = require('./web-companion-path.cjs');
const { writeOnlineSeed } = require('./online-seed.cjs');
const root = path.resolve(__dirname, '..');
const desktop = process.argv.includes('--desktop');
const native = process.argv.includes('--native');
const web = process.argv.includes('--web');
const firefox = process.argv.includes('--firefox');
if (firefox && !web) throw Error('--firefox requires --web');
const storePreviews = process.argv.includes('--store-previews');
if (!desktop && !web) throw Error('Specify --desktop and/or --web');
if (native && !desktop) throw Error('--native requires --desktop and a stopped desktop instance');
const changes = [];
const backup = fs.mkdtempSync(path.join(root, 'dist/local-runtime-backup-'));
const allowed = /\.(?:cjs|js|css|html|json)$/i;

function queueTree(source, target, key, include = () => true, fileTypes = allowed) {
  for (const entry of fs.readdirSync(source, {withFileTypes:true})) {
    const src = path.join(source, entry.name), dst = path.join(target, entry.name);
    if (!include(entry.name)) continue;
    if (entry.isDirectory()) queueTree(src, dst, path.join(key, entry.name), include, fileTypes);
    else if (entry.isFile() && fileTypes.test(entry.name) && !entry.name.endsWith('.test.cjs')) {
      const after = fs.readFileSync(src);
      const before = fs.existsSync(dst) ? fs.readFileSync(dst) : null;
      if (!before?.equals(after)) changes.push({dst, before, after, key:path.join(key,entry.name)});
    }
  }
}
const seed = path.join(backup, 'preview-seed');
if (storePreviews) writeOnlineSeed(path.join(root, 'online-assets'), seed);
function queueSeed(target, key) {
  if (storePreviews) queueTree(seed, target, key, name => /^(wallpapers|catalog\.json|moriyama-catgirl-0[1-9]\.jpg)$/.test(name), /\.(?:jpg|json)$/i);
}
if (desktop) {
  const suite = path.resolve(process.env.LOCALAPPDATA, 'Programs/Catstella/Suite');
  const app = path.join(suite, 'resources/app');
  if (fs.realpathSync(suite).toLowerCase() !== suite.toLowerCase() ||
      fs.readFileSync(path.join(suite,'.starsuite-install'),'utf8').trim() !== 'Suite' ||
      JSON.parse(fs.readFileSync(path.join(app,'package.json'),'utf8')).name !== 'catstella') {
    throw Error('Expected the installed Catstella Suite');
  }
  const staging = path.join(backup, 'staged');
  if(native){
    const crypto=require('node:crypto');
    const nativeDir='Antigravity-Cat-Widget/src/native';
    const version=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,nativeDir,'ForegroundHost.cs'))).digest('hex').slice(0,12);
    const source=path.join(root,nativeDir,'ForegroundHost.'+version+'.exe');
    const dst=path.join(app,nativeDir,'ForegroundHost.exe');
    const after=fs.readFileSync(source),before=fs.readFileSync(dst);
    if(!before.equals(after))changes.push({dst,before,after,key:path.join('desktop',nativeDir,'ForegroundHost.exe')});
  }
  const pet = 'Antigravity-Cat-Widget/src';
  fs.cpSync(path.join(root,pet),path.join(staging,pet),{recursive:true});
  stripByokUi(staging);
  queueTree(path.join(staging,pet),path.join(app,pet),path.join('desktop',pet),
    name => name !== 'native' && !name.startsWith('byok-portal'));
  for (const area of ['Antigravity-Dream-Skin/src/host', 'Antigravity-Dream-Skin/src/domain', 'Antigravity-Dream-Skin/assets/localization', 'shared']) {
    queueTree(path.join(root,area),path.join(app,area),path.join('desktop',area),
      name => !['vendor','gateway'].includes(name));
  }
  const dialogue = 'Antigravity-Cat-Widget/assets/dialogue';
  queueTree(path.join(root,dialogue),path.join(app,dialogue),path.join('desktop',dialogue));
  const motionStyles = 'Antigravity-Cat-Widget/assets/motions';
  queueTree(path.join(root,motionStyles),path.join(app,motionStyles),path.join('desktop',motionStyles),name=>name==='gemini-widget.css');
  const notes = 'Antigravity-Cat-Widget/assets/release-notes.json';
  const notesTarget = path.join(app,notes), notesAfter = fs.readFileSync(path.join(root,notes));
  const notesBefore = fs.existsSync(notesTarget) ? fs.readFileSync(notesTarget) : null;
  if (!notesBefore?.equals(notesAfter)) changes.push({dst:notesTarget,before:notesBefore,after:notesAfter,key:path.join('desktop',notes)});
  const packageTarget = path.join(app,'package.json');
  const packageBefore = fs.readFileSync(packageTarget);
  const packageData = JSON.parse(packageBefore);
  const version = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
  if (packageData.version !== version) changes.push({dst:packageTarget,before:packageBefore,
    after:Buffer.from(JSON.stringify({...packageData,version})),key:'desktop/package.json'});
  queueSeed(path.join(app,'online-assets'),'desktop/online-assets');
}
if (web) {
  const source = detectWebCompanion({ root });
  const target = path.join(source.dist, firefox ? 'firefox' : 'chromium');
  const webKey = firefox ? 'web-firefox' : 'web';
  const manifestPath = path.join(target,'manifest.json');
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  if (fs.realpathSync(target).toLowerCase() !== target.toLowerCase() ||
      (firefox ? !manifest.background?.scripts?.includes('background.js') : manifest.background?.service_worker !== 'background.js')) throw Error('Expected the existing browser load directory');
  for (const area of ['content','popup','online']) {
    queueTree(path.join(source.base,area),path.join(target,area),path.join(webKey,area));
  }
  queueSeed(path.join(target,'online/seed'),webKey+'/online/seed');
  const dst = path.join(target,'background.js');
  const before = fs.readFileSync(dst), after = fs.readFileSync(path.join(source.base,'background.js'));
  if (!before.equals(after)) changes.push({dst,before,after,key:webKey+'/background.js'});
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(source.base,'manifest.json'),'utf8'));
  const widgetGroup = data => data.content_scripts.find(group => group.js?.includes('content/widget.js'));
  const liveGroup = widgetGroup(manifest), sourceGroup = widgetGroup(sourceManifest);
  let manifestChanged = false;
  if (JSON.stringify(liveGroup.js) !== JSON.stringify(sourceGroup.js)) {
    for (const name of sourceGroup.js) {
      if (!/^(?:content\/[\w.-]+|online\/(?:panel|content-hub|store))\.js$/.test(name) || !fs.existsSync(path.join(source.base,name))) {
        throw Error('Unexpected content script: ' + name);
      }
    }
    liveGroup.js = sourceGroup.js;
    manifestChanged = true;
  }
  const resourceGroup = data => data.web_accessible_resources.find(group => group.matches.includes('*://gemini.google.com/*'));
  const storeStyles = 'online/content-hub.css';
  const resources = resourceGroup(manifest).resources;
  if (resourceGroup(sourceManifest).resources.includes(storeStyles) && !resources.includes(storeStyles)) {
    resources.push(storeStyles);
    manifestChanged = true;
  }
  if (manifestChanged) {
    changes.push({ dst:manifestPath, before:manifestBytes, after:Buffer.from(JSON.stringify(manifest,null,2)+'\n'), key:webKey+'/manifest.json' });
  }
}
function replace(file, bytes) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp = file + '.catstella-live-' + process.pid;
  try { fs.writeFileSync(temp,bytes,{flag:'wx'}); fs.renameSync(temp,file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
const applied = [];
if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify({desktop,web,dryRun:true,changed:changes.map(item=>item.key),backup}));
  process.exit(0);
}
try {
  for (const item of changes) {
    if (item.before) replace(path.join(backup,item.key),item.before);
    replace(item.dst,item.after);
    applied.push(item);
  }
  for (const item of changes) if (!fs.readFileSync(item.dst).equals(item.after)) throw Error('Verification failed: '+item.key);
} catch (error) {
  for (const item of applied.reverse()) {
    if (item.before) replace(item.dst,item.before);
    else fs.unlinkSync(item.dst);
  }
  throw error;
}
console.log(JSON.stringify({desktop,web,changed:changes.map(item=>item.key),backup}));
