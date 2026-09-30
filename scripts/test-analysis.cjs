const vm=require('node:vm');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
async function run(){
 const code=require('esbuild').buildSync({stdin:{contents:"export {prepareAudio,rankScores} from './src/audio-core';export {parseExtraTreesBundle,extractClassicalFeatures,predictExtraTrees} from './src/vendor/extra-trees';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',globalName:'Core'}).outputFiles[0].text;
 const context={Float32Array,Float64Array,Int32Array,Int16Array,Uint8Array,DataView,ArrayBuffer,performance,console};vm.createContext(context);vm.runInContext(code,context);
 const {prepareAudio,rankScores,parseExtraTreesBundle,extractClassicalFeatures,predictExtraTrees}=context.Core;
 const bytes=fs.readFileSync('dist/models/reason-v0.6.bin');const bundle=parseExtraTreesBundle(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 const analyze=async(samples,rate=16000,boost=true)=>{
   try{const p=prepareAudio(samples,rate,boost);if(!p.audio)return p;const features=extractClassicalFeatures(p.audio);if(features[212]>.55)return {status:'noise'};return {status:'classified',...rankScores(predictExtraTrees(bundle,features)),boosted:p.boosted};}catch{return {type:'error'};}
 };
 assert.equal((await analyze(new Float32Array(49152))).status,'quiet');
 assert.equal((await analyze(new Float32Array(49152).fill(1))).status,'clipped');
 assert.equal((await analyze(new Float32Array(10))).type,'error');
 let seed=5;const noise=Float32Array.from({length:49152},()=>{seed=(seed*1664525+1013904223)>>>0;return (seed/2**32-.5)*.2;});
 assert.equal((await analyze(noise)).status,'noise');
 // Synthetic modulated harmonic signal exercises real weights; this is not a labeled accuracy evaluation.
 function signal(rate){return Float32Array.from({length:Math.round(rate*3.072)},(_,i)=>{const t=i/rate;return .12*(.6+.4*Math.sin(t*12))*(Math.sin(t*2*Math.PI*430)+.3*Math.sin(t*2*Math.PI*860));});}
 const a=await analyze(signal(16000));const b=await analyze(signal(48000),48000);const c=await analyze(signal(44100),44100);
 for(const r of [a,b,c]){assert.equal(r.status,'classified');assert.equal(r.ranked.length,6);assert.ok(Math.abs(r.ranked.reduce((s,x)=>s+x.score,0)-1)<1e-5);assert.ok(r.ranked.every(x=>Number.isFinite(x.score)));assert.equal(typeof r.uncertain,'boolean');}
 const faint=Float32Array.from(signal(16000),x=>x*.03);
 assert.equal((await analyze(faint,16000,false)).status,'quiet','original microphone mode blocks low volume');
 const boosted=await analyze(faint);assert.equal(boosted.status,'classified');assert.equal(boosted.boosted,true);
 const scores=new Map(a.ranked.map(x=>[x.label,x.score]));
 for(const item of boosted.ranked)assert.ok(Math.abs(item.score-scores.get(item.label))<.005,'boost preserves same-signal model output');
 assert.equal((await analyze(new Float32Array(49152).fill(.004))).status,'quiet','DC offset is not sound');
 assert.equal((await analyze(Float32Array.from(noise,x=>x*.03))).status,'noise','quiet noise stays rejected after boost');
 assert.equal(a.ranked[0].label,b.ranked[0].label);assert.equal(a.ranked[0].label,c.ranked[0].label);
 let Processor;const batches=[];const aw={sampleRate:48000,Float32Array,AudioWorkletProcessor:class{constructor(){this.port={postMessage:m=>batches.push(m)};}},registerProcessor:(name,p)=>Processor=p};vm.createContext(aw);vm.runInContext(fs.readFileSync('dist/audio-capture.js','utf8'),aw);const processor=new Processor();
 for(let n=0;n<1152;n++)processor.process([[new Float32Array(128).fill(.1)]],[[new Float32Array(128)]]);
 assert.equal(batches.length,1);assert.equal(batches[0].samples.length,147456);assert.equal(batches[0].sampleRate,48000);
 for(let n=0;n<576;n++)processor.process([[new Float32Array(128).fill(.2)]],[[new Float32Array(128)]]);
 assert.equal(batches.length,2,'half-window hop');
 assert.ok(Math.abs(batches[1].samples[0]-.1)<1e-6);
 assert.ok(Math.abs(batches[1].samples.at(-1)-.2)<1e-6,'ring buffer preserves order');
 console.log('PASS low-volume regression, amplitude invariance, DC rejection, quiet-noise rejection, overlapping capture.');
 console.log('PASS real 1000-tree inference, silence/noise/clipping gates, invalid input, 16/44.1/48kHz consistency, exact worklet capture length.');

}
run().catch(e=>{console.error(e);process.exit(1);});
