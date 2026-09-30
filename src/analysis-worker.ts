import {prepareAudio,rankScores} from './audio-core';
import {AudioClassifier,FilesetResolver} from '@mediapipe/tasks-audio';
import {decideCry} from './cry-gate';
import {extractClassicalFeatures,parseExtraTreesBundle,predictExtraTrees} from './vendor/extra-trees';

let detector:AudioClassifier|null=null;
let bundle: ReturnType<typeof parseExtraTreesBundle>|null=null;
const MODEL_HASH='17dcfff76704f433ca6bbf25430c75691f280715e8591615fb782995197b7edc';
async function checkedFile(path:string,expected:string){
  const response=await fetch(path,{cache:'force-cache'});
  if(!response.ok)throw new Error('Model download failed');
  const buffer=await response.arrayBuffer();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))).map(x=>x.toString(16).padStart(2,'0')).join('');
  if(digest!==expected)throw new Error('Model checksum mismatch');
  return buffer;
}
async function load(){
  postMessage({type:'progress',stage:'download'});
  const [reason,cry]=await Promise.all([
    checkedFile('models/reason-v0.6.bin',MODEL_HASH),
    checkedFile('models/yamnet.tflite','4d8b4a53282dc83ef04e3e7dbc4fbc98082e34e44ed798e16c3a0cdd4c584faf')
  ]);
  bundle=parseExtraTreesBundle(reason);
  postMessage({type:'progress',stage:'detector'});
  const files=await FilesetResolver.forAudioTasks(new URL('vendor/mediapipe',self.location.href).href);
  detector=await AudioClassifier.createFromOptions(files,{baseOptions:{modelAssetBuffer:new Uint8Array(cry)},maxResults:-1});
  // Exercise the actual inference path before announcing readiness.
  detector.classify(new Float32Array(15600),16000);
  postMessage({type:'ready'});
}
self.onmessage=async({data})=>{
  try{
    if(data.type==='init'){await load();return;}
    if(data.type!=='analyze'||!bundle||!detector)throw new Error('Model not ready');
    const begin=performance.now();
    const prepared=prepareAudio(data.samples,data.sampleRate,data.boost!==false);
    if(!prepared.audio){postMessage({type:'result',id:data.id,status:prepared.status,inputDb:prepared.inputDb,gainDb:prepared.gainDb});return;}
    // Exactly three full 0.975 s YAMNet frames; ignore padded tail predictions.
    const detected=decideCry(detector.classify(prepared.audio.subarray(0,46800),16000));
    if(detected.status!=='cry'){
      postMessage({type:'result',id:data.id,status:detected.status==='not_cry'?'not_cry':'cry_unconfirmed',soundIndex:detected.topIndex,inputDb:prepared.inputDb,gainDb:prepared.gainDb,durationMs:Math.round(performance.now()-begin)});
      return;
    }
    postMessage({type:'progress',stage:'reason',id:data.id});
    const features=extractClassicalFeatures(prepared.audio);
    // Mean spectral flatness is feature 212 in the upstream 217-feature contract.
    if(features[212]>.55){postMessage({type:'result',id:data.id,status:'noise',inputDb:prepared.inputDb,gainDb:prepared.gainDb});return;}
    const prediction=rankScores(predictExtraTrees(bundle,features));
    postMessage({type:'result',id:data.id,status:'classified',cryDetected:true,...prediction,inputDb:prepared.inputDb,gainDb:prepared.gainDb,boosted:prepared.boosted,durationMs:Math.round(performance.now()-begin)});
  }catch(error){postMessage({type:'error',message:error instanceof Error?error.message:'Analysis failed'});}
};
