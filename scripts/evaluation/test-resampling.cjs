const vm=require('node:vm'),assert=require('node:assert/strict');
const code=require('esbuild').buildSync({stdin:{contents:"export {resampleMono} from './scripts/evaluation/bandlimited-resample';",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'Experimental'}).outputFiles[0].text;vm.runInThisContext(code);
const {resampleMono}=Experimental;
 // Anti-alias checks use the raw resampler, before automatic gain.
 const rms=x=>Math.sqrt(x.reduce((sum,v)=>sum+v*v,0)/x.length);
 for(const rate of [44100,48000]){
  const tone=hz=>Float32Array.from({length:Math.round(rate*3.072)},(_,i)=>.1*Math.sin(2*Math.PI*hz*i/rate));
  const low=resampleMono(tone(1000),rate).subarray(256,-256);
  const high=resampleMono(tone(12000),rate).subarray(256,-256);
  assert.ok(Math.abs(rms(low)-.1/Math.sqrt(2))<.001,'preserve speech-band amplitude');
  assert.ok(rms(high)<.0001,'suppress above-Nyquist alias by at least 57dB');
 }
 const unchanged=Float32Array.from({length:49152},(_,i)=>Math.sin(i)*.1);
 assert.deepEqual(resampleMono(unchanged,16000),unchanged,'16kHz inputs unchanged');

console.log('PASS experimental filter fidelity. Not enabled in production.');
