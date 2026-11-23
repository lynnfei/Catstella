const {test}=require('node:test'),assert=require('node:assert/strict');
const {selectWallpaper}=require('../src/domain/wallpaper-selection.cjs');
const packs=[{id:'a',file:'/fixture/a.png'},{id:'b',file:'/fixture/b.png',aliases:['old-b'],aliasFiles:['/fixture/legacy.png']}];
const manager={defaultId:'a',usablePacks:()=>packs};
test('wallpaper id wins over a stale file on every normal selection and restart',()=>{
 assert.deepEqual(selectWallpaper(manager,{wallpaperId:'b',wallpaperFile:packs[0].file}),{wallpaperId:'b',wallpaperFile:packs[1].file});
 assert.equal(selectWallpaper(manager,{wallpaperId:'old-b',wallpaperFile:packs[0].file}).wallpaperId,'b');
 assert.equal(selectWallpaper(manager,{wallpaperId:'a',wallpaperFile:packs[1].file}).wallpaperId,'a');
});
test('file-only legacy choices remain supported without becoming a second authority',()=>{
 assert.equal(selectWallpaper(manager,{wallpaperId:'a',wallpaperFile:packs[1].file},{fileOnly:true}).wallpaperId,'b');
 assert.equal(selectWallpaper(manager,{wallpaperId:'missing',wallpaperFile:packs[1].file}).wallpaperId,'b');
 assert.equal(selectWallpaper(manager,{wallpaperId:'missing',wallpaperFile:'/fixture/missing'}).wallpaperId,'a');
});
