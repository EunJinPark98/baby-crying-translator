// Compare a frozen old frontend and the production frontend on identical WAV windows.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=process.cwd(),study=path.resolve(process.argv[2]||''),output=process.argv[3];
if(!output)throw new Error('Usage: node scripts/evaluation/compare-preprocessing.cjs study-directory report.json');
global.require=require;global.__dirname=path.join(root,'dist/vendor/mediapipe');global.self=global;global.location={href:'file://'+root+'/dist/analysis-worker.js'};
global.importScripts=file=>vm.runInThisContext(fs.readFileSync(String(file).replace(/^file:\/\//,''),'utf8'));
global.fetch=async url=>{const file=path.resolve(String(url).replace(/^file:\/\//,''));if(!file.startsWith(path.join(root,'dist')+path.sep))throw new Error('Only packaged assets allowed');return new Response(fs.readFileSync(file),{headers:{'Content-Type':file.endsWith('.wasm')?'application/wasm':'application/octet-stream'}});};
const {AudioClassifier,FilesetResolver}=require('@mediapipe/tasks-audio');
const code=require('esbuild').buildSync({stdin:{contents:"export {prepareAudio} from './scripts/evaluation/filtered-audio-core';export {prepareAudio as legacy} from './scripts/evaluation/legacy-audio-core';export {decideCry} from './src/cry-gate';",resolveDir:root},bundle:true,write:false,format:'iife',globalName:'Comparison'}).outputFiles[0].text;vm.runInThisContext(code);
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
 const classify=(input,rate,prepare)=>{const p=prepare(input,rate);return p.audio?Comparison.decideCry(detector.classify(p.audio.subarray(0,46800),16000)).status:p.status;};
 try{for(const file of manifest.files){const {rate,audio}=readWav(path.join(study,'audio',file.filename));
  for(const offset of [0,1.5]){const input=audio.slice(Math.round(offset*rate),Math.round(offset*rate)+Math.round(3.072*rate));rows.push({file:file.filename,sourceSha256:file.sha256,category:file.category,offset,rate,legacy:classify(input,rate,Comparison.legacy),filtered:classify(input,rate,Comparison.prepareAudio)});}
 }}finally{detector.close();}
 const summary={};for(const field of ['legacy','filtered']){summary[field]={cryWindows:rows.filter(r=>r.category==='crying_baby').length,cryDetected:rows.filter(r=>r.category==='crying_baby'&&r[field]==='cry').length,nonCryWindows:rows.filter(r=>r.category!=='crying_baby').length,falseCry:rows.filter(r=>r.category!=='crying_baby'&&r[field]==='cry').length};}
 fs.writeFileSync(output,JSON.stringify({datasetRevision:manifest.revision,limitations:'Fixed selected ESC-50 subset, overlapping windows; training overlap unknown, no reason ground truth. No thresholds tuned. Not independent real-world accuracy.',summary,rows},null,2)+'\n');console.log(summary);
})().catch(e=>{console.error(e);process.exit(1);});
