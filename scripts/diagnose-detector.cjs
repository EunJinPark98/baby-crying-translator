// Local-only diagnostics. Reads Float32 fixtures, writes scores and hashes, never audio.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const root=process.cwd(),fixtures=process.argv[2],output=process.argv[3];
if(!fixtures||!output){console.error('Usage: node scripts/diagnose-detector.cjs /absolute/fixtures /absolute/report.json');process.exit(1);}
global.require=require;global.__dirname=path.join(root,'dist/vendor/mediapipe');global.self=global;global.location={href:'file://'+root+'/dist/analysis-worker.js'};
global.importScripts=file=>vm.runInThisContext(fs.readFileSync(String(file).replace(/^file:\/\//,''),'utf8'));
global.fetch=async url=>{const file=path.resolve(String(url).replace(/^file:\/\//,''));if(!file.startsWith(path.join(root,'dist')+path.sep))throw new Error('Only packaged assets are allowed');return new Response(fs.readFileSync(file),{headers:{'Content-Type':file.endsWith('.wasm')?'application/wasm':'application/octet-stream'}});};
const {AudioClassifier,FilesetResolver}=require('@mediapipe/tasks-audio');
const code=require('esbuild').buildSync({stdin:{contents:"export {prepareAudio} from './src/audio-core';export {decideCry} from './src/cry-gate';",resolveDir:root},bundle:true,write:false,format:'iife',globalName:'DiagnosticCore'}).outputFiles[0].text;vm.runInThisContext(code);
(async()=>{
 const files=await FilesetResolver.forAudioTasks(path.join(root,'dist/vendor/mediapipe'));
 const model=await AudioClassifier.createFromOptions(files,{baseOptions:{modelAssetBuffer:new Uint8Array(fs.readFileSync('dist/models/yamnet.tflite'))},maxResults:-1});
 const rows=[];
 try{
  for(const name of fs.readdirSync(fixtures).filter(x=>x.endsWith('.f32')).sort()){
   const bytes=fs.readFileSync(path.join(fixtures,name));if(bytes.length!==49152*4)throw new Error('Expected 3.072s at 16kHz mono float32: '+name);
   const prepared=DiagnosticCore.prepareAudio(new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),16000);
   const row={file:name,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),preprocessing:prepared.status,inputDb:prepared.inputDb,gainDb:prepared.gainDb};
   if(prepared.audio){
    const results=model.classify(prepared.audio.subarray(0,46800),16000);
    row.decision=DiagnosticCore.decideCry(results);
    row.frames=results.map(frame=>{
     const scores=frame.classifications[0].categories;
     return {babyCry:scores.find(x=>x.index===20)?.score??0,top:scores.slice().sort((a,b)=>b.score-a.score).slice(0,3).map(x=>({index:x.index,label:x.categoryName,score:x.score}))};
    });
   }
   rows.push(row);
  }
 }finally{model.close();}
 fs.writeFileSync(output,JSON.stringify({date:new Date().toISOString().slice(0,10),modelSha256:crypto.createHash('sha256').update(fs.readFileSync('dist/models/yamnet.tflite')).digest('hex'),limitations:'Selected overlapping smoke fixtures, not independent accuracy validation. Scores are model outputs, not calibrated probabilities. No reason ground truth.',rows},null,2)+'\n');
 console.log('Wrote detector diagnostics for '+rows.length+' local windows.');
})().catch(e=>{console.error(e);process.exit(1);});
