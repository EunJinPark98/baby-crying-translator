// Runs the shipped worker and its real WASM models under a Node worker-like host.
// This checks runtime integration, not browser permissions or classification accuracy.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve('dist');const messages=[];
global.require=require;global.__dirname=path.join(root,'vendor/mediapipe');global.self=global;
global.location={href:'file://'+root+'/analysis-worker.js'};
global.crypto=require('node:crypto').webcrypto;
global.importScripts=file=>vm.runInThisContext(fs.readFileSync(String(file).replace(/^file:\/\//,''),'utf8'),{filename:file});
global.fetch=async(url)=>{const raw=String(url).replace(/^file:\/\//,'');const file=path.isAbsolute(raw)?raw:path.join(root,raw);assert.ok(file.startsWith(root+path.sep),'runtime must use packaged assets only');return new Response(fs.readFileSync(file),{headers:{'Content-Type':file.endsWith('.wasm')?'application/wasm':'application/octet-stream'}});};
global.postMessage=message=>messages.push(message);
vm.runInThisContext(fs.readFileSync(path.join(root,'analysis-worker.js'),'utf8'));
(async()=>{
 await global.onmessage({data:{type:'init'}});assert.equal(messages.at(-1).type,'ready',JSON.stringify(messages));
 async function analyze(samples,rate=16000){await global.onmessage({data:{type:'analyze',samples,sampleRate:rate,id:1,boost:true}});return messages.at(-1);}
 assert.equal((await analyze(new Float32Array(49152))).status,'quiet');
 assert.equal((await analyze(new Float32Array(49152).fill(1))).status,'clipped');
 const tone=Float32Array.from({length:49152},(_,i)=>.1*Math.sin(i*2*Math.PI*440/16000));
 const r=await analyze(tone);assert.ok(['not_cry','cry_unconfirmed'].includes(r.status),JSON.stringify(r));assert.equal(r.ranked,undefined,'no reason result for non-cry');
 assert.equal((await analyze(new Float32Array(10))).type,'error');
 const fixtureDir=process.env.CRY_FIXTURES;
 if(fixtureDir){
  let cried=false;
  for(const file of fs.readdirSync(fixtureDir).filter(x=>x.endsWith('.f32'))){
    const buffer=fs.readFileSync(path.join(fixtureDir,file));const samples=new Float32Array(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));
    const actual=await analyze(samples);console.log('fixture',file,actual.status,actual.ranked?.[0]?.label||'',actual.durationMs||'');
    if(file.startsWith('crying_baby')&&actual.status==='classified')cried=true;
    if(!file.startsWith('crying_baby'))assert.notEqual(actual.status,'classified','non-cry smoke fixture was sent to reason model');
  }
  assert.equal(cried,true,'at least one real cry smoke fixture reaches the reason model');
 }
 console.log('PASS shipped worker + packaged MediaPipe WASM + both real model weights; silence, clipping, pure-tone gate, invalid input.');
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
