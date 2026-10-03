import {resampleMono} from './bandlimited-resample';
const sampleCount=49152;
const labels=['belly_pain','burping','discomfort','hungry','lonely','scared'];
export function prepareAudio(input:Float32Array,rate:number,boost=true){
  if(!Number.isFinite(rate)||rate<8000||rate>192000||!(input instanceof Float32Array)||input.length<rate*2.9||input.length>rate*3.3)throw new Error('Invalid audio window');
  let clipped=0;
  for(const value of input){
    if(!Number.isFinite(value))throw new Error('Invalid audio sample');
    if(Math.abs(value)>.985)clipped++;
  }
  const audio=resampleMono(input,rate,sampleCount);
  let energy=0,peak=0,crossings=0,mean=0;
  for(const value of audio)mean+=value;
  // Remove microphone DC offset before measuring useful signal energy.
  mean/=sampleCount;
  for(let i=0;i<audio.length;i++){
    audio[i]-=mean;energy+=audio[i]*audio[i];peak=Math.max(peak,Math.abs(audio[i]));
    if(i&&((audio[i]<0)!==(audio[i-1]<0)))crossings++;
  }
  const rms=Math.sqrt(energy/sampleCount),db=20*Math.log10(Math.max(rms,1e-12));
  const diagnostics={inputDb:Math.round(db),gainDb:0,boosted:false};
  if(clipped/input.length>.01)return {status:'clipped',audio:null,...diagnostics};
  // Optional input gain extends the upstream 12 dB cap for quiet phone microphones.
  // This is an application adaptation; no accuracy improvement is claimed.
  if(db < (boost?-65:-50))return {status:'quiet',audio:null,...diagnostics};
  if(crossings/(sampleCount-1)>.4)return {status:'noise',audio:null,...diagnostics};
  const cap=boost?36:12;
  const gain=Math.min(Math.max(Math.pow(10,(-23-db)/20),Math.pow(10,-12/20)),Math.pow(10,cap/20),Math.pow(10,-1/20)/Math.max(peak,1e-12));
  for(let i=0;i<audio.length;i++)audio[i]*=gain;
  return {status:'ready',audio,inputDb:Math.round(db),gainDb:Math.round(20*Math.log10(gain)),boosted:gain>Math.pow(10,12/20)};
}
export function rankScores(scores:number[]){
  if(scores.length!==labels.length||scores.some(x=>!Number.isFinite(x)||x<0))throw new Error('Invalid model output');
  const ranked=labels.map((label,i)=>({label,score:scores[i]})).sort((a,b)=>b.score-a.score);
  // Conservative product abstention, not a calibrated probability threshold.
  return {ranked,uncertain:ranked[0].score<.55||ranked[0].score-ranked[1].score<.15};
}
