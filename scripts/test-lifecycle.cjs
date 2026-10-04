const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const noop=()=>{};
function setup(){
 const els={},workers=[],events={},trackEvents={};let latestCapture,mediaResolve,mediaReject,mediaOptions;const timers=new Map();let timerId=0,stopped=0;
 const el=id=>els[id]??={textContent:'',value:'unknown',checked:false,style:{},hidden:false,clientWidth:500,clientHeight:60,children:[],replaceChildren(){this.children=[];},append(...children){this.children.push(...children);},play:async()=>{},getContext:()=>({setTransform:noop,clearRect:noop,beginPath:noop,moveTo:noop,lineTo:noop,stroke:noop}),focus(){this.focused=true;},showModal(){this.open=true;},close(){this.open=false;}};
 class AC{constructor(){this.currentTime=3.072;this.audioWorklet={addModule:async()=>{}};this.destination={};}async resume(){}async close(){}addEventListener(){}createAnalyser(){return {fftSize:2048,getFloatTimeDomainData:noop};}createMediaStreamSource(){return{connect:noop,disconnect:noop};}}
 class Capture{constructor(){latestCapture=this;this.port={};}connect(){}disconnect(){this.disconnected=true;}}
 class Worker{constructor(){workers.push(this);this.sent=[];}postMessage(x){this.sent.push(x);}terminate(){this.terminated=true;}}
 const ctx={document:{getElementById:el,createElement:()=>({className:'',append:noop}),addEventListener:(n,f)=>events[n]=f},window:{devicePixelRatio:1,isSecureContext:true,AudioContext:AC,AudioWorkletNode:Capture,addEventListener:noop},AudioWorkletNode:Capture,Worker,navigator:{mediaDevices:{getUserMedia:options=>{mediaOptions=options;return new Promise((resolve,reject)=>{mediaResolve=resolve;mediaReject=reject;});}}},performance,requestAnimationFrame:()=>1,cancelAnimationFrame:noop,setInterval:()=>1,clearInterval:noop,setTimeout:f=>{timers.set(++timerId,f);return timerId;},clearTimeout:id=>timers.delete(id),Float32Array,AbortController,console};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('dist/app.js','utf8'),ctx);
 return{ctx,el,workers,events,trackEvents,run:s=>vm.runInContext(s,ctx),rejectMedia:name=>mediaReject(Object.assign(new Error(name),{name})),flushMedia:()=>mediaResolve({getVideoTracks:()=>[{stop:noop}],getAudioTracks:()=>[{addEventListener:(name,handler)=>trackEvents[name]=handler}],getTracks:()=>[{stop:()=>stopped++,addEventListener:noop}]}),get mediaOptions(){return mediaOptions;},get capture(){return latestCapture;},get stopped(){return stopped;}};
}
(async()=>{
 const a=setup();a.el('enableAI').checked=true;
 const start=a.el('empty').onclick();await a.el('empty').onclick();assert.equal(a.el('empty').disabled,true,'permission request prevents repeated clicks');assert.equal(a.el('stop').hidden,false,'can cancel permission request');await new Promise(setImmediate);a.flushMedia();await start;
 assert.equal(a.workers.length,1);const worker=a.workers[0];worker.onmessage({data:{type:'ready'}});
 a.capture.port.onmessage({data:{samples:new Float32Array(49152),sampleRate:16000,endTime:3.072,sequence:1}});
 a.capture.port.onmessage({data:{samples:new Float32Array(49152),sampleRate:16000,endTime:3.072,sequence:2}});
 assert.equal(worker.sent.filter(x=>x.type==='analyze').length,1,'no analysis backlog');

 const id=worker.sent[1].id;
 const ranked=[{label:'hungry',score:.8},{label:'burping',score:.1}];
 const first={type:'result',id,status:'classified',uncertain:false,ranked,durationMs:200};
 worker.onmessage({data:first});
 assert.equal(a.el('candidates').hidden,true,'one window must not show a reason');
 worker.onmessage({data:first});
 assert.equal(a.el('candidates').hidden,true,'duplicate response cannot corroborate itself');
 let sequence=2;
 function respond(data,wallTime){
   a.capture.port.onmessage({data:{samples:new Float32Array(49152),sampleRate:16000,endTime:3.072,sequence:++sequence}});
   if(wallTime!==undefined)a.run('currentWindow.wallTime='+wallTime);
   worker.onmessage({data:{type:'result',id:worker.sent.at(-1).id,...data}});
 }
 const strong={status:'classified',uncertain:false,ranked,durationMs:200};
 respond(strong);
 assert.equal(a.el('candidates').hidden,true,'a dropped window breaks consecutive agreement');
 const capturedAt=Date.UTC(2026,9,3,1,2,3);respond(strong,capturedAt);
 assert.equal(a.el('analysisMeta').textContent,'마지막 소리 수집 · '+new Date(capturedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),'timestamp reflects capture rather than inference completion');
 assert.match(a.el('resultTitle').textContent,/배고픔 후보/);
 assert.equal(a.el('liveTitle').textContent,'울음으로 감지했어요');
 assert.equal(a.el('retainedHint').hidden,true,'fresh match is not marked as previous audio');
 assert.equal(a.el('candidateLabel').textContent,'마지막 원인 후보');
 const title=a.el('resultTitle').textContent,stamp=a.el('analysisMeta').textContent;
 for(const status of ['quiet','not_cry','noise','clipped','cry_unconfirmed']){
   respond({status,soundIndex:0});
   assert.equal(a.el('resultTitle').textContent,title,status+' retains last result');
   assert.equal(a.el('analysisMeta').textContent,stamp,status+' retains actual timestamp');
   assert.equal(a.el('candidates').hidden,false);
   assert.equal(a.el('retainedHint').hidden,false,status+' marks the retained candidate as historical');
   assert.notEqual(a.el('liveTitle').textContent,'울음으로 감지했어요',status+' updates live observation independently');
 }
 respond({status:'classified',uncertain:true,ranked:[{label:'burping',score:.3},{label:'hungry',score:.29}]});
 assert.equal(a.el('resultTitle').textContent,title,'uncertainty retains previous candidate');
 assert.match(a.el('modelStatus').textContent,/구분하기 어려워요/);
 const changed={status:'classified',uncertain:false,ranked:[{label:'burping',score:.8},{label:'hungry',score:.1}]};
 respond(changed);assert.equal(a.el('resultTitle').textContent,title,'one conflicting result does not replace card');
 respond({status:'quiet'});respond(changed);
 assert.equal(a.el('resultTitle').textContent,title,'silence breaks agreement');
 respond(changed);assert.match(a.el('resultTitle').textContent,/트림 후보/);
 const finalTitle=a.el('resultTitle').textContent;
 assert.match(a.el('resultBody').textContent,/수유 직후/,'candidate has actionable guidance');
 const count=a.workers.length;a.el('boost').onchange();assert.equal(a.workers.length,count,'gain change must not reload models');
 const meter=a.run('meterSamples');a.run('tick(100000);tick(100060)');assert.equal(a.run('meterSamples'),meter,'meter buffer reused');
 const savedTime=a.el('analysisMeta').textContent;
 respond(strong);
 a.capture.port.onmessage({data:{samples:new Float32Array(49152),sampleRate:16000,endTime:3.072,sequence:++sequence}});
 a.run('currentWindow.at-=11000');worker.onmessage({data:{type:'result',id:worker.sent.at(-1).id,...strong}});
 assert.equal(a.el('resultTitle').textContent,finalTitle,'delayed inference cannot replace last result');
 assert.equal(a.el('analysisMeta').textContent,savedTime,'delayed inference does not refresh timestamp');
 respond(strong);assert.equal(a.el('resultTitle').textContent,finalTitle,'delayed inference resets pending agreement');
 a.capture.port.onmessage({data:{samples:new Float32Array(49152),sampleRate:16000,endTime:3.072,sequence:++sequence}});
 a.el('boost').checked=true;a.el('boost').onchange();a.el('boost').checked=false;a.el('boost').onchange();
 worker.onmessage({data:{type:'result',id:worker.sent.at(-1).id,...strong}});
 assert.equal(a.el('resultTitle').textContent,finalTitle,'gain change away and back invalidates in-flight result');

 a.run("modelError('연결 오류')");
 assert.equal(a.el('resultTitle').textContent,finalTitle,'error retains candidate');
 assert.equal(a.el('analysisMeta').textContent,savedTime,'error retains original timestamp');
 assert.equal(a.el('modelStatus').textContent,'연결 오류','error details stay visible');assert.equal(a.el('liveTitle').textContent,'AI 분석이 중단됐어요');
 a.el('enableAI').checked=false;a.el('enableAI').onchange();
 assert.equal(a.el('analysisMeta').textContent,savedTime,'AI off retains timestamp');
 a.el('enableAI').checked=true;
 a.run('switchCamera()');await new Promise(setImmediate);a.flushMedia();await new Promise(setImmediate);
 assert.equal(a.el('resultTitle').textContent,finalTitle,'camera switch retains candidate');
 assert.equal(a.el('analysisMeta').textContent,savedTime,'camera switch retains timestamp');

 a.run('stop()');assert.equal(a.stopped,2);assert.equal(a.el('empty').disabled,false);assert.equal(a.el('stop').hidden,true);
 assert.equal(worker.terminated,true);assert.equal(a.el('candidates').hidden,false,'stop retains readable result');
 assert.equal(a.capture.port.onmessage,null);assert.match(a.el('modelStatus').textContent,/듣기 종료/);
 worker.onmessage({data:first});assert.equal(a.el('resultTitle').textContent,finalTitle,'ignore stale model result');
 assert.equal(a.el('liveTitle').textContent,'듣기를 마쳤어요');
 a.el('checkContext').onclick();assert.equal(a.el('contextPanel').open,true);assert.equal(a.el('contextSummary').focused,true,'manual context receives focus');
 a.el('verification').onclick();assert.equal(a.el('aboutDialog').open,true);a.el('closeAbout').onclick();assert.equal(a.el('aboutDialog').open,false);
 const restart=a.el('empty').onclick();assert.equal(a.el('candidates').hidden,true,'new session resets last result');assert.equal(a.el('retainedHint').hidden,true);assert.equal(a.el('candidateDetails').hidden,true);assert.equal(a.el('resultTitle').textContent,'아직 후보가 없어요');
 await new Promise(setImmediate);a.flushMedia();await restart;a.run('stop()');
 const b=setup();const pending=b.el('empty').onclick();await new Promise(setImmediate);b.run('stop()');b.flushMedia();await pending;assert.equal(b.stopped,1,'late permission result releases tracks');assert.equal(b.workers.length,0);
 const mic=setup();const micStart=mic.el('audioOnly').onclick();await new Promise(setImmediate);assert.equal(mic.mediaOptions.video,false,'audio-only does not request camera');mic.flushMedia();await micStart;assert.equal(mic.el('switch').disabled,true);assert.equal(mic.el('cameraStatus').textContent,'마이크 켜짐');mic.run('stop()');
 const cameraMissing=setup();const missingStart=cameraMissing.el('empty').onclick();await new Promise(setImmediate);cameraMissing.rejectMedia('NotFoundError');await new Promise(setImmediate);assert.equal(cameraMissing.mediaOptions.video,false,'missing camera falls back to audio');cameraMissing.flushMedia();await missingStart;assert.equal(cameraMissing.el('cameraStatus').textContent,'마이크 켜짐');cameraMissing.run('stop()');
 const playback=setup();playback.el('video').play=async()=>{throw Object.assign(new Error('blocked'),{name:'NotAllowedError'});};playback.el('enableAI').checked=true;const playbackStart=playback.el('empty').onclick();await new Promise(setImmediate);playback.flushMedia();await playbackStart;assert.equal(playback.el('cameraStatus').textContent,'마이크 켜짐');assert.equal(playback.workers.length,1,'video autoplay failure does not disable analysis');assert.equal(playback.el('switch').disabled,true);playback.run('stop()');
 const denied=setup();const deniedStart=denied.el('empty').onclick();await new Promise(setImmediate);denied.rejectMedia('NotAllowedError');await deniedStart;assert.equal(denied.workers.length,0);assert.equal(denied.el('empty').disabled,false,'permission denial returns to idle');assert.notEqual(denied.mediaOptions.video,false,'permission denial must not trigger repeated permission request');
 const c=setup();c.run('demo()');assert.match(c.el('resultBody').textContent,/가상 예시/);c.ctx.document.hidden=true;c.events.visibilitychange();assert.equal(c.el('stop').disabled,true);
 // Failure injection must release resources without losing a displayed candidate.
 for(const failure of ['processor','port','mute','worker-message','post-message','malformed','invalid-scores']){
  const f=setup();f.el('enableAI').checked=true;const starting=f.el('audioOnly').onclick();await new Promise(setImmediate);f.flushMedia();await starting;
  const w=f.workers[0];w.onmessage({data:{type:'ready'}});
  f.run("lastResult=true");f.el('resultTitle').textContent='보존 후보';f.el('analysisMeta').textContent='원래 시각';
  if(failure==='processor')f.capture.onprocessorerror();
  if(failure==='port')f.capture.port.onmessageerror();
  if(failure==='mute')f.trackEvents.mute();
  if(failure==='worker-message')w.onmessageerror();
  if(failure==='malformed')w.onmessage({data:null});
  if(failure==='post-message'){w.postMessage=()=>{throw new Error('DataCloneError');};f.capture.port.onmessage({data:{samples:new Float32Array(49152),sampleRate:16000,endTime:3.072,sequence:1}});}
  if(failure==='invalid-scores'){
   f.capture.port.onmessage({data:{samples:new Float32Array(49152),sampleRate:16000,endTime:3.072,sequence:1}});
   w.onmessage({data:{type:'result',id:w.sent.at(-1).id,status:'classified',uncertain:false,ranked:[{label:'hungry',score:1.8},{label:'hungry',score:.1}]}});
  }
  assert.equal(f.el('resultTitle').textContent,'보존 후보',failure+' preserves candidate');assert.equal(f.el('analysisMeta').textContent,'원래 시각',failure+' preserves capture time');assert.equal(w.terminated,true,failure+' terminates failed inference');
  if(['processor','port','mute'].includes(failure)){assert.equal(f.stopped,1);assert.equal(f.el('stop').hidden,true);assert.equal(f.capture.port.onmessage,null);assert.equal(f.capture.onprocessorerror,null);assert.ok(f.el('error').textContent.length>0);}
  else{assert.equal(f.el('retryAI').hidden,false);assert.equal(f.run('analysisBusy'),false);f.run('stop()');}
 }
 console.log('PASS result retention, two-window agreement, silence/uncertainty/conflict handling, restart reset, one-tap start, repeat-click guard, live lifecycle, no inference queue, track/worker cleanup, stale-result suppression, cancellation during permissions, demo/background cleanup.');
})().catch(e=>{console.error(e);process.exit(1);});
