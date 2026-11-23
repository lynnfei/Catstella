// Manual, marked input sampling. Four alternating one-pixel moves cancel out.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),readline=require('node:readline');
const {spawn,execFileSync}=require('node:child_process');
async function main(){
 const label=process.argv[2];if(!['before','stopped','after'].includes(label))throw Error('Specify before, stopped or after');
 const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'catstella-input-sample-'));let child;
 try{
  const exe=path.join(dir,'probe.exe');execFileSync(path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),['/nologo','/out:'+exe,path.join(root,'tools/MouseLatencyProbe.cs')]);
  child=spawn(exe,[],{windowsHide:true,stdio:['pipe','pipe','inherit']});const lines=readline.createInterface({input:child.stdout})[Symbol.asyncIterator]();
  const next=async()=>{let timer;try{return await Promise.race([lines.next(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('input sample timeout')),6000);})]);}finally{clearTimeout(timer);}};
  if((await next()).value!=='ready')throw Error('probe not ready');const delays=[];
  for(let i=0;i<4;i++){child.stdin.write('probe\n');delays.push(JSON.parse((await next()).value).delayMs);await new Promise(r=>setTimeout(r,100));}
  const result={checkedAt:new Date().toISOString(),label,delaysMs:delays,maxMs:Math.max(...delays)};
  fs.writeFileSync(path.join(root,'evidence/mouse-input-'+label+'-2026-11-10.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{if(child){child.stdin.end('quit\n');await new Promise(r=>setTimeout(r,100));if(child.exitCode===null)child.kill();}fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1});
