// Asset rescans must not synchronously decode and encode unchanged artwork.
class PreviewCache {
 constructor(nativeImage,{stat=require('node:fs').statSync,limit=256}={}){this.nativeImage=nativeImage;this.stat=stat;this.limit=limit;this.entries=new Map();}
 get(file,width){
  const stat=this.stat(file),key=file+':'+width,revision=stat.size+':'+stat.mtimeMs;
  const cached=this.entries.get(key);
  if(cached?.revision===revision)return cached.preview;
  const preview=this.nativeImage.createFromPath(file).resize({width}).toDataURL();
  this.entries.delete(key);this.entries.set(key,{revision,preview});
  while(this.entries.size>this.limit)this.entries.delete(this.entries.keys().next().value);
  return preview;
 }
 clear(){this.entries.clear();}
}
module.exports={PreviewCache};
