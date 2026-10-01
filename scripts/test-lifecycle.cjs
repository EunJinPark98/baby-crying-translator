const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const noop=()=>{};
function setup(){
 const els={},workers=[],events={};let latestCapture,mediaResolve;const timers=new Map();let timerId=0,stopped=0;
 const el=id=>els[id]??={textContent:'',value:'unknown',checked:false,style:{},hidden:false,clientWidth:500,clientHeight:60,children:[],replaceChildren(){this.children=[];},append(...children){this.children.push(...children);},play:async()=>{},getContext:()=>({setTransform:noop,clearRect:noop,beginPath:noop,moveTo:noop,lineTo:noop,stroke:noop}),showModal:noop,close:noop};
 class AC{constructor(){this.audioWorklet={addModule:async()=>{}};this.destination={};}async resume(){}async close(){}addEventListener(){}createAnalyser(){return {fftSize:2048,getFloatTimeDomainData:noop};}createMediaStreamSource(){return{connect:noop,disconnect:noop};}}
 class Capture{constructor(){latestCapture=this;this.port={};}connect(){}disconnect(){this.disconnected=true;}}
 class Worker{constructor(){workers.push(this);this.sent=[];}postMessage(x){this.sent.push(x);}terminate(){this.terminated=true;}}
 const ctx={document:{getElementById:el,createElement:()=>({className:'',append:noop}),addEventListener:(n,f)=>events[n]=f},window:{devicePixelRatio:1,isSecureContext:true,AudioContext:AC,AudioWorkletNode:Capture,addEventListener:noop},AudioWorkletNode:Capture,Worker,navigator:{mediaDevices:{getUserMedia:()=>new Promise(r=>mediaResolve=r)}},performance,requestAnimationFrame:()=>1,cancelAnimationFrame:noop,setInterval:()=>1,clearInterval:noop,setTimeout:f=>{timers.set(++timerId,f);return timerId;},clearTimeout:id=>timers.delete(id),Float32Array,AbortController,console};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('dist/app.js','utf8'),ctx);
 return{ctx,el,workers,events,run:s=>vm.runInContext(s,ctx),flushMedia:()=>mediaResolve({getTracks:()=>[{stop:()=>stopped++,addEventListener:noop}]}),get capture(){return latestCapture;},get stopped(){return stopped;}};
}
(async()=>{
 const a=setup();a.el('enableAI').checked=true;
 const start=a.el('empty').onclick();await a.el('empty').onclick();assert.equal(a.el('empty').disabled,true,'permission request prevents repeated clicks');assert.equal(a.el('stop').hidden,false,'can cancel permission request');await new Promise(setImmediate);a.flushMedia();await start;
 assert.equal(a.workers.length,1);const worker=a.workers[0];worker.onmessage({data:{type:'ready'}});
 a.capture.port.onmessage({data:{samples:new Float32Array(49152),sampleRate:16000,sequence:1}});
 a.capture.port.onmessage({data:{samples:new Float32Array(49152),sampleRate:16000,sequence:2}});
 assert.equal(worker.sent.filter(x=>x.type==='analyze').length,1,'no analysis backlog');

 const id=worker.sent[1].id;
 const ranked=[{label:'hungry',score:.8},{label:'burping',score:.1}];
 const first={type:'result',id,status:'classified',uncertain:false,ranked,durationMs:200};
 worker.onmessage({data:first});
 assert.equal(a.el('candidates').hidden,true,'one window must not show a reason');
 worker.onmessage({data:first});
 assert.equal(a.el('candidates').hidden,true,'duplicate response cannot corroborate itself');
 function respond(data){
   a.capture.port.onmessage({data:{samples:new Float32Array(49152),sampleRate:16000}});
   worker.onmessage({data:{type:'result',id:worker.sent.at(-1).id,...data}});
 }
 const strong={status:'classified',uncertain:false,ranked,durationMs:200};
 respond(strong);
 assert.match(a.el('resultTitle').textContent,/배고픔 후보/);
 const title=a.el('resultTitle').textContent,stamp=a.el('analysisMeta').textContent;
 for(const status of ['quiet','not_cry','noise','clipped','cry_unconfirmed']){
   respond({status,soundIndex:0});
   assert.equal(a.el('resultTitle').textContent,title,status+' retains last result');
   assert.equal(a.el('analysisMeta').textContent,stamp,status+' retains actual timestamp');
   assert.equal(a.el('candidates').hidden,false);
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
 const savedTime=a.el('analysisMeta').textContent;
 a.run("modelError('연결 오류')");
 assert.equal(a.el('resultTitle').textContent,finalTitle,'error retains candidate');
 assert.equal(a.el('analysisMeta').textContent,savedTime,'error retains original timestamp');
 assert.equal(a.el('modelStatus').textContent,'연결 오류','error details stay visible');
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
 const restart=a.el('empty').onclick();assert.equal(a.el('candidates').hidden,true,'new session resets last result');
 await new Promise(setImmediate);a.flushMedia();await restart;a.run('stop()');
 const b=setup();const pending=b.el('empty').onclick();await new Promise(setImmediate);b.run('stop()');b.flushMedia();await pending;assert.equal(b.stopped,1,'late permission result releases tracks');assert.equal(b.workers.length,0);
 const c=setup();c.run('demo()');assert.match(c.el('resultBody').textContent,/가상 예시/);c.ctx.document.hidden=true;c.events.visibilitychange();assert.equal(c.el('stop').disabled,true);
 console.log('PASS result retention, two-window agreement, silence/uncertainty/conflict handling, restart reset, one-tap start, repeat-click guard, live lifecycle, no inference queue, track/worker cleanup, stale-result suppression, cancellation during permissions, demo/background cleanup.');
})().catch(e=>{console.error(e);process.exit(1);});
