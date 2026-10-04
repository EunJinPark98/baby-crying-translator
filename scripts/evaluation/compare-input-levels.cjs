// Fixed paired input-level experiment; production code and thresholds are unchanged.
const crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=process.cwd(),study=path.resolve(process.argv[2]||''),output=process.argv[3];
if(!output)throw new Error('Usage: node scripts/evaluation/compare-input-levels.cjs study-directory report.json');
global.require=require;global.__dirname=path.join(root,'dist/vendor/mediapipe');global.self=global;global.location={href:'file://'+root+'/dist/analysis-worker.js'};
global.importScripts=file=>vm.runInThisContext(fs.readFileSync(String(file).replace(/^file:\/\//,''),'utf8'));
global.fetch=async url=>{const file=path.resolve(String(url).replace(/^file:\/\//,''));if(!file.startsWith(path.join(root,'dist')+path.sep))throw new Error('Only packaged assets allowed');return new Response(fs.readFileSync(file),{headers:{'Content-Type':file.endsWith('.wasm')?'application/wasm':'application/octet-stream'}});};
const {AudioClassifier,FilesetResolver}=require('@mediapipe/tasks-audio');
const code=require('esbuild').buildSync({stdin:{contents:"export {prepareAudio} from './src/audio-core';export {decideCry} from './src/cry-gate';",resolveDir:root},bundle:true,write:false,format:'iife',globalName:'Comparison'}).outputFiles[0].text;vm.runInThisContext(code);
function readWav(file){
 const b=fs.readFileSync(file);if(b.toString('ascii',0,4)!=='RIFF'||b.toString('ascii',8,12)!=='WAVE')throw new Error('Not WAV');
 let rate,channels,format,bits,data;
 for(let offset=12;offset+8<=b.length;){const kind=b.toString('ascii',offset,offset+4),size=b.readUInt32LE(offset+4),start=offset+8;if(start+size>b.length)throw new Error('Truncated WAV');
  if(kind==='fmt '){format=b.readUInt16LE(start);channels=b.readUInt16LE(start+2);rate=b.readUInt32LE(start+4);bits=b.readUInt16LE(start+14);}if(kind==='data')data=b.subarray(start,start+size);offset=start+size+(size%2);
 }
 if(format!==1||channels!==1||bits!==16||!data)throw new Error('Expected mono PCM16 WAV');
 return {rate,audio:Float32Array.from({length:data.length/2},(_,i)=>data.readInt16LE(i*2)/32768)};
}
(async()=>{
 const files=await FilesetResolver.forAudioTasks(path.join(root,'dist/vendor/mediapipe'));
 const detector=await AudioClassifier.createFromOptions(files,{baseOptions:{modelAssetBuffer:new Uint8Array(fs.readFileSync('dist/models/yamnet.tflite'))},maxResults:-1});
 const manifest=JSON.parse(fs.readFileSync(path.join(study,'sources.json'))),rows=[];
 const classify=(input,rate,boost)=>{const p=Comparison.prepareAudio(input,rate,boost);return {status:p.audio?Comparison.decideCry(detector.classify(p.audio.subarray(0,46800),16000)).status:p.status,inputDb:p.inputDb,gainDb:p.gainDb};};
 try{for(const file of manifest.files){
  const wav=path.join(study,'audio',file.filename);
  if(crypto.createHash('sha256').update(fs.readFileSync(wav)).digest('hex')!==file.sha256)throw new Error('Source hash mismatch: '+file.filename);
  const {rate,audio}=readWav(wav);
  for(const offset of [0,1.5])for(const attenuationDb of [0,20,40]){
   const input=audio.slice(Math.round(offset*rate),Math.round(offset*rate)+Math.round(3.072*rate));
   const gain=10**(-attenuationDb/20);for(let i=0;i<input.length;i++)input[i]*=gain;
   rows.push({file:file.filename,sourceSha256:file.sha256,category:file.category,offset,rate,attenuationDb,off:classify(input,rate,false),on:classify(input,rate,true)});
  }
 }}finally{detector.close();}
 const summary=[];for(const attenuationDb of [0,20,40])for(const mode of ['off','on']){
  const selected=rows.filter(r=>r.attenuationDb===attenuationDb);
  summary.push({attenuationDb,mode,cryWindows:80,cryDetected:selected.filter(r=>r.category==='crying_baby'&&r[mode].status==='cry').length,nonCryWindows:144,falseCry:selected.filter(r=>r.category!=='crying_baby'&&r[mode].status==='cry').length,quiet:selected.filter(r=>r[mode].status==='quiet').length});
 }
 fs.writeFileSync(output,JSON.stringify({protocol:'Fixed before execution: original / -20dB / -40dB; boost off vs on; no threshold adjustment; file labels inherited, no added microphone noise.',datasetRevision:manifest.revision,modelSha256:crypto.createHash('sha256').update(fs.readFileSync('dist/models/yamnet.tflite')).digest('hex'),limitations:'Fixed selected ESC-50 subset, overlapping windows; training overlap unknown, no reason ground truth. No thresholds tuned. Not independent real-world accuracy.',summary,sources:manifest.files,rows:rows.map(({sourceSha256,...rest})=>rest)})+'\n');console.log(summary);
})().catch(e=>{console.error(e);process.exit(1);});
