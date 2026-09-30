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
 const start=a.run('start()');await new Promise(setImmediate);a.flushMedia();await start;
 assert.equal(a.workers.length,1);const worker=a.workers[0];worker.onmessage({data:{type:'ready'}});
 a.capture.port.onmessage({data:{samples:new Float32Array(49152),sampleRate:16000,sequence:1}});
 a.capture.port.onmessage({data:{samples:new Float32Array(49152),sampleRate:16000,sequence:2}});
 assert.equal(worker.sent.filter(x=>x.type==='analyze').length,1,'no analysis backlog');
 const id=worker.sent[1].id;worker.onmessage({data:{type:'result',id,status:'classified',uncertain:false,ranked:[{label:'hungry',score:.8}],durationMs:200}});assert.match(a.el('resultTitle').textContent,/배고픔/);
 a.capture.port.onmessage({data:{samples:new Float32Array(49152),sampleRate:16000,sequence:3}});
 worker.onmessage({data:{type:'result',id:worker.sent.at(-1).id,status:'classified',uncertain:true,ranked:[{label:'hungry',score:.3},{label:'burping',score:.29}],durationMs:100}});assert.equal(a.el('candidates').hidden,false,'uncertain candidates visible');assert.match(a.el('resultState').textContent,/불확실/);
 a.run('stop()');assert.equal(a.stopped,1);assert.equal(worker.terminated,true);assert.equal(a.el('candidates').hidden,true);assert.equal(a.capture.port.onmessage,null);
 worker.onmessage({data:{type:'result',id,status:'classified',uncertain:false,ranked:[{label:'hungry'}]}});assert.equal(a.el('resultTitle').textContent,'어떤 소리가 들릴까요?','ignore stale model result');
 const b=setup();const pending=b.run('start()');await new Promise(setImmediate);b.run('stop()');b.flushMedia();await pending;assert.equal(b.stopped,1,'late permission result releases tracks');assert.equal(b.workers.length,0);
 const c=setup();c.run('demo()');assert.match(c.el('resultBody').textContent,/가상 예시/);c.ctx.document.hidden=true;c.events.visibilitychange();assert.equal(c.el('stop').disabled,true);
 console.log('PASS live lifecycle, no inference queue, track/worker cleanup, stale-result suppression, cancellation during permissions, demo/background cleanup.');
})().catch(e=>{console.error(e);process.exit(1);});
