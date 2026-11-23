// Release gate: behavior, not merely stylesheet presence or a single fade.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {detectWebCompanion}=require('./web-companion-path.cjs');
const root=path.resolve(__dirname,'..'),web=detectWebCompanion({root});
if(!web||!['content/skin.css','content/fade.js'].every(file=>fs.existsSync(path.join(web.base,file))))throw Error('Appearance gate requires the actual Web source; set WEB_COMPANION_PATH.');
// The gate owns its fixture and dependencies while testing the exact Web source
// selected by the checkout, including a release's pinned Web tag.
for(const name of ['tools/verify-agy-invariants.cjs','tools/verify-agy-scroll-glass.cjs','tools/verify-agy-wallpaper.cjs','tools/verify-web-footer.cjs','Antigravity-Cat-Widget/test/settings-browser.cjs']){
 const file=path.join(root,name);
 execFileSync(process.execPath,[file],{cwd:root,stdio:'inherit',env:process.env,timeout:120000});
}
console.log('PASS: appearance release gate (AGY rounded surfaces, lightweight alpha, rotation, Web footer fade, bounded slider saves).');
