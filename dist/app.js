'use strict';
const $=id=>document.getElementById(id);
const wave=$('wave'),pen=wave.getContext('2d');
let stream=null,ctx=null,source=null,analyser=null,capture=null,worker=null;
let raf=0,timer=0,modelTimeout=0,analysisTimeout=0,running=false,preview=false,busy=false;
let facing='environment',epoch=0,started=0,lastPaint=0,workerReady=false,analysisBusy=false,requestId=0,receivedClip=0;
function stages(detection,reason){$('detectorState').textContent=detection;$('reasonState').textContent=reason;}
const labelNames={belly_pain:'배 불편',burping:'트림',discomfort:'불편함',hungry:'배고픔',lonely:'관심 필요',scared:'놀람'};
function result(state,title,body){$('resultState').textContent=state;$('resultTitle').textContent=title;$('resultBody').textContent=body;}
function clearCandidates(){ $('candidates').replaceChildren();$('candidates').hidden=true;$('analysisMeta').textContent=''; }
function showCandidates(ranked){
  clearCandidates();for(const [index,item] of ranked.slice(0,3).entries()){
    const row=document.createElement('div');row.className='candidate';const order=document.createElement('small');order.textContent=`${index+1}위`;
    const label=document.createElement('strong');label.textContent=(labelNames[item.label]||'알 수 없음')+' 라벨';row.append(order,label);$('candidates').append(row);
  }$('candidates').hidden=false;
}
function draw(data){
  const ratio=Math.min(window.devicePixelRatio||1,2),w=wave.clientWidth,h=wave.clientHeight;
  if(wave.width!==Math.round(w*ratio)||wave.height!==Math.round(h*ratio)){wave.width=Math.round(w*ratio);wave.height=Math.round(h*ratio);}
  pen.setTransform(ratio,0,0,ratio,0,0);pen.clearRect(0,0,w,h);pen.strokeStyle='#b68029';pen.lineWidth=2;pen.beginPath();
  for(let x=0;x<w;x++){const v=data?data[Math.floor(x/w*data.length)]:0,y=h/2+v*h*.46;if(!x)pen.moveTo(x,y);else pen.lineTo(x,y);}pen.stroke();
}
function updateClock(){const secs=Math.floor((performance.now()-started)/1000);$('session').textContent=(preview?'예시':'측정 중')+' · '+String(Math.floor(secs/60)).padStart(2,'0')+':'+String(secs%60).padStart(2,'0');}
function controls(){
  $('start').disabled=running||busy;$('stop').disabled=!running&&!busy;$('demo').disabled=running||busy;$('switch').disabled=!running||preview||busy;
  $('enableAI').disabled=preview;$('boost').disabled=preview;
}
function stopWorker(){
  clearTimeout(modelTimeout);clearTimeout(analysisTimeout);if(worker)worker.terminate();worker=null;workerReady=false;analysisBusy=false;receivedClip=0;stages('대기','대기');clearCandidates();$('retryAI').hidden=true;
  $('modelStatus').textContent=$('enableAI').checked?'AI 대기 · 카메라 시작 후 연결':'AI 꺼짐';
}
function stop(message='시작하면 영상과 소리를 실시간으로 확인해요.'){
  epoch++;running=false;preview=false;busy=false;cancelAnimationFrame(raf);clearInterval(timer);stopWorker();
  if(capture){capture.port.onmessage=null;capture.disconnect();capture=null;}
  if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;
  if(source)source.disconnect();source=null;
  const old=ctx;ctx=null;analyser=null;if(old)old.close().catch(()=>{});
  $('micReading').textContent='마이크 연결 전';$('video').srcObject=null;$('empty').style.display='flex';$('cameraStatus').textContent='카메라 꺼짐';$('modeLabel').textContent='LIVE VIEW';$('levelText').textContent='마이크 대기';$('meter').style.width='0%';$('session').textContent='준비 중 · 00:00';$('start').textContent='카메라 켜고 시작하기';result('READY TO LISTEN','어떤 소리가 들릴까요?',message);draw();controls();
}
function errorText(e){return ({NotAllowedError:'카메라·마이크 권한이 필요해요. 사이트 설정에서 허용해 주세요. 앱 안에서 열었다면 Safari 또는 Chrome에서 열어 주세요.',NotFoundError:'카메라 또는 마이크를 찾지 못했어요.',NotReadableError:'다른 앱이 카메라나 마이크를 사용 중일 수 있어요. 해당 앱을 닫고 다시 시작해 주세요.',OverconstrainedError:'요청한 카메라를 사용할 수 없어요.'})[e.name]||'기기를 시작하지 못했어요. Safari 또는 Chrome에서 다시 열어 주세요.';}
async function start(){
  if(busy||running)return;$('error').textContent='';
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){$('error').textContent='보안 연결(HTTPS)의 Safari 또는 Chrome에서 열어 주세요.';return;}
  busy=true;const ticket=++epoch;controls();$('start').textContent='권한 확인 중…';
  try{
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('Audio unavailable');
    const ac=new AC();ctx=ac;await ac.resume();if(ticket!==epoch)return;
    const received=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:1280}},audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1}});
    if(ticket!==epoch){received.getTracks().forEach(t=>t.stop());return;}stream=received;
    $('video').srcObject=stream;await $('video').play();if(ticket!==epoch)return;
    analyser=ac.createAnalyser();analyser.fftSize=2048;source=ac.createMediaStreamSource(stream);source.connect(analyser);
    stream.getTracks().forEach(t=>t.addEventListener('ended',()=>{if(ticket===epoch&&(running||busy))stop('기기 연결이 끊어졌어요. 다시 시작해 주세요.');}));
    ac.addEventListener('statechange',()=>{if(ticket===epoch&&running&&(ac.state==='suspended'||ac.state==='interrupted'))stop('오디오가 중단되어 종료했어요. 다시 시작해 주세요.');});
    running=true;busy=false;started=performance.now();lastPaint=0;$('empty').style.display='none';$('cameraStatus').textContent='카메라 · 마이크 켜짐';$('start').textContent='실시간으로 듣는 중';controls();timer=setInterval(updateClock,1000);updateClock();result('LISTENING','소리를 듣고 있어요','실시간 울음 분석을 켜면 울음을 감지한 구간만 원인 후보와 비교해요.');tick();
    if(ac.audioWorklet&&window.AudioWorkletNode){
      try{
        await ac.audioWorklet.addModule('audio-capture.js?v=4');if(ticket!==epoch)return;
        capture=new AudioWorkletNode(ac,'cry-capture');source.connect(capture);capture.connect(ac.destination);
        capture.port.onmessage=({data})=>{
          if(ticket!==epoch||!running||!workerReady||analysisBusy||!$('enableAI').checked)return;
          analysisBusy=true;receivedClip++;const id=++requestId;
          $('modelStatus').textContent='소리 종류 확인 중 · 약 3초 구간';stages('분석 중','기다리는 중');
          worker.postMessage({type:'analyze',id,...data,boost:$('boost').checked},[data.samples.buffer]);
          analysisTimeout=setTimeout(()=>{if(ticket===epoch)modelError('분석이 지연됐어요. 다시 연결해 주세요.');},20000);
        };
        if($('enableAI').checked)startWorker();
      }catch(e){if(ticket===epoch)modelError('이 브라우저에서는 실시간 AI 분석을 시작하지 못했어요. Safari 또는 Chrome에서 다시 열어 주세요.');}
    }else modelError('이 브라우저는 실시간 AI 분석을 지원하지 않아요. 영상과 소리 크기만 표시해요.');
  }catch(e){if(ticket!==epoch)return;stop();$('error').textContent=errorText(e);}
}
function modelError(message){stopWorker();$('modelStatus').textContent=message;$('retryAI').hidden=!running||!capture;result('AI UNAVAILABLE','AI 분석이 중단됐어요','영상과 소리 크기는 확인할 수 있어요. 이전 분석 결과는 지웠어요.');}
function startWorker(){
  stopWorker();if(!running||preview||!$('enableAI').checked)return;
  if(!capture){$('modelStatus').textContent='오디오 연결을 준비하고 있어요';return;}
  const ticket=epoch;
  try{
    const current=new Worker('analysis-worker.js?v=4');worker=current;$('modelStatus').textContent='AI 모델 준비 중 · 최초 약 19MB';
    result('MODEL LOADING','AI를 준비하고 있어요','모델을 기기에 내려받고 있어요. 아기 소리는 전송하지 않아요.');
    const active=()=>ticket===epoch&&worker===current&&running&&$('enableAI').checked;
    current.onerror=()=>{if(active())modelError('AI 연결에 실패했어요. 다시 연결해 주세요.');};
    current.onmessage=({data})=>{
      if(!active())return;
      if(data.type==='progress'){if(data.stage==='reason'&&data.id===requestId){stages('울음으로 감지','분석 중');$('modelStatus').textContent='울음 감지 · 원인 후보 비교 중';}else if(data.stage==='download'){$('modelStatus').textContent='두 분석 모델을 내려받고 있어요';stages('준비 중','준비 중');}else if(data.stage==='detector'){$('modelStatus').textContent='울음 감지 기능을 시작하고 있어요';stages('준비 중','준비 완료');}return;}
      if(data.type==='ready'){clearTimeout(modelTimeout);workerReady=true;stages('준비 완료','준비 완료');$('modelStatus').textContent='AI 준비 완료 · 소리 수집 중';result('AI LISTENING','울음 소리를 모으고 있어요','약 3초의 소리가 모이면 울음인지 먼저 확인해요.');return;}
      if(data.type==='error'){modelError('AI 분석을 완료하지 못했어요. 다시 연결해 주세요.');return;}
      if(data.type!=='result'||data.id!==requestId)return;
      clearTimeout(analysisTimeout);analysisBusy=false;clearCandidates();$('modelStatus').textContent='AI 켜짐 · 다음 구간 기다리는 중';
      const statuses={quiet:['분석할 소리를 기다리고 있어요',$('boost').checked?'보정 후에도 입력이 매우 작아요. 마이크가 가려졌는지 확인하고, 울음이 들릴 때 다시 확인해 주세요.':'작은 소리 자동 보정을 켜거나 마이크가 가려졌는지 확인해 주세요.'],clipped:['소리가 찌그러지고 있어요','마이크에 소리가 너무 크게 들어와 분석을 보류했어요.'],noise:['소음이 많이 섞여 있어요','울음 라벨과 비교하기 어려워 분석을 보류했어요.']};
      if(statuses[data.status]){stages('음질 확인 필요','보류');result('ANALYSIS PAUSED',...statuses[data.status]);return;}
      if(data.status==='not_cry'||data.status==='cry_unconfirmed'){
        const soundNames={0:'말소리',1:'아이 말소리',2:'대화',4:'옹알이',13:'웃음',14:'아기 웃음',19:'울음',69:'강아지 소리',70:'짖는 소리',132:'음악',371:'청소기 소리',494:'무음',507:'잡음',514:'백색 소음',518:'TV 소리'};
        if(data.status==='not_cry'){const name=soundNames[data.soundIndex];stages('다른 소리로 감지','분석하지 않음');result('OTHER SOUND',name?`${name}에 가까워요`:'울음 외의 소리로 감지됐어요','이번 구간에서는 아기 울음이 뚜렷하지 않아 원인 분석을 건너뛰었어요. 감지 결과는 틀릴 수 있어요.');}
        else{stages('확인 중','기다리는 중');result('CHECKING FOR CRY','울음인지 확인하고 있어요','소리가 섞이거나 아기 울음 신호가 약해요. 다음 구간을 더 들어볼게요.');}
        $('analysisMeta').textContent=`${new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})} 갱신 · 울음 감지 단계`;
        return;
      }
      if(data.status!=='classified'||!Array.isArray(data.ranked)){modelError('분석 결과를 읽지 못했어요.');return;}
      stages('울음으로 감지',data.uncertain?'후보 불확실':'후보 비교 완료');
      if(data.uncertain){showCandidates(data.ranked);result('UNCERTAIN · 불확실','원인 후보를 비교하고 있어요','현재 소리와 비교한 후보예요. 점수가 낮거나 후보 차이가 작아 하나를 고를 수 없어요.');}
      else{showCandidates(data.ranked);const name=labelNames[data.ranked[0].label]||'알 수 없음';result('EXPERIMENTAL MATCH',`${name} 라벨과 비슷해요`,'학습 데이터와의 유사성 순위예요. 실제 울음 원인이나 아기의 요구를 확정한 결과는 아니에요.');}
      $('analysisMeta').textContent=`${new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})} 갱신 · 처리 ${(data.durationMs/1000).toFixed(1)}초${data.boosted?' · 작은 소리 보정 적용':''}`;
    };
    current.postMessage({type:'init'});modelTimeout=setTimeout(()=>{if(active())modelError('모델을 내려받지 못했어요. 네트워크를 확인하고 다시 연결해 주세요.');},90000);
  }catch(e){modelError('이 브라우저에서 AI를 시작하지 못했어요.');}
}
function toggleAI(){
  if(preview)return;
  if(!$('enableAI').checked){stopWorker();if(running)result('LISTENING','소리를 듣고 있어요','AI 분석을 껐어요. 영상과 소리 크기만 표시해요.');}
  else if(running)startWorker();else $('modelStatus').textContent='AI 대기 · 카메라 시작 후 연결';
}
function tick(now=performance.now()){
  if(!running||preview||!analyser)return;
  const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);
  let sum=0;for(const s of samples)sum+=s*s;const db=20*Math.log10(Math.max(Math.sqrt(sum/samples.length),.00001));const level=Math.min(100,Math.max(0,(db+65)/55*100));
  draw(samples);$('meter').style.width=level+'%';
  if(now-lastPaint>400){lastPaint=now;$('levelText').textContent=level<8?'작은 소리 입력':level<55?'소리가 들려요':'비교적 큰 소리';$('micReading').textContent=`입력 ${Math.round(db)} dBFS`;}raf=requestAnimationFrame(tick);
}
function switchCamera(){if(!running||preview||busy)return;facing=facing==='environment'?'user':'environment';stop();start();}
function demo(){
  if(running||busy)return;preview=true;running=true;started=performance.now();$('error').textContent='';$('cameraStatus').textContent='예시 · 실제 카메라 아님';$('modeLabel').textContent='DEMO · 예시 화면';$('empty').style.display='flex';$('levelText').textContent='예시 파형';$('modelStatus').textContent='예시 · 모델 실행 안 함';stages('예시: 울음 감지','예시: 후보 비교');
  result('DEMO · 예시','배고픔 라벨과 비슷해요','이 화면은 가상 예시이며, 실제 아기의 소리를 분석한 결과가 아니에요.');showCandidates([{label:'hungry'},{label:'discomfort'},{label:'burping'}]);$('analysisMeta').textContent='가상 예시 · 실제 분석 아님';$('start').textContent='예시 살펴보는 중';controls();timer=setInterval(updateClock,1000);updateClock();
  function frame(t){if(!preview)return;draw(Float32Array.from({length:512},(_,i)=>Math.sin(i*.14+t*.004)*Math.sin(i*.027)*.5));$('meter').style.width=(45+Math.sin(t*.002)*15)+'%';raf=requestAnimationFrame(frame);}raf=requestAnimationFrame(frame);
}
function context(){const feed=$('feed').value,sleep=$('sleep').value;let title='아기의 표정과 주변 환경',body='소리만으로 원인을 정할 수 없어요. 아기를 직접 살펴보며 필요한 것을 확인해 주세요.';if(sleep==='hungry'||feed==='long'){title='수유가 필요한지 살펴봐 주세요';body='선택한 수유 간격이나 행동을 바탕으로 한 안내예요. 평소 수유 패턴과 지금 보이는 먹고 싶어 하는 신호를 함께 확인해 주세요.';}if(sleep==='tired'){title='졸린 모습인지 살펴봐 주세요';body='하품·눈 비빔을 선택하셨어요. 마지막 잠에서 깬 시간과 주변 빛·소음을 함께 확인해 보세요.';}if(sleep==='uncomfortable'){title='기저귀와 옷, 주변을 확인해 주세요';body='불편해 보이는 모습을 선택하셨어요. 젖은 기저귀나 조이는 옷이 있는지 직접 확인해 보세요.';}$('suggestTitle').textContent=title;$('suggestBody').textContent=body;}
$('start').onclick=start;$('stop').onclick=()=>stop();$('switch').onclick=switchCamera;$('demo').onclick=demo;$('enableAI').onchange=toggleAI;$('retryAI').onclick=()=>{$('enableAI').checked=true;startWorker();};$('boost').onchange=()=>{if(running&&!preview&&$('enableAI').checked)startWorker();};$('feed').onchange=context;$('sleep').onchange=context;$('about').onclick=()=>$('aboutDialog').showModal();$('closeAbout').onclick=()=>$('aboutDialog').close();
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(running||busy))stop('화면을 벗어나 측정을 종료했어요. 다시 시작해 주세요.');});window.addEventListener('pagehide',()=>stop());window.addEventListener('resize',()=>{if(!running)draw();});draw();
if(document.modelContext?.registerTool){const lifecycle=new AbortController();try{Promise.resolve(document.modelContext.registerTool({name:'read_sound_session',title:'소리 관찰 상태 확인',description:'현재 화면의 관찰 상태와 실험 AI 연결 여부를 읽습니다. 녹음이나 카메라를 시작하지 않습니다.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('입력은 빈 객체여야 합니다.');return{running,demo:preview,status:$('resultTitle').textContent,contextSuggestion:$('suggestTitle').textContent,experimentalAIEnabled:$('enableAI').checked,modelReady:workerReady,validatedCryTranslationAvailable:false};}},{signal:lifecycle.signal})).catch(()=>{});}catch{}window.addEventListener('pagehide',()=>lifecycle.abort());}
