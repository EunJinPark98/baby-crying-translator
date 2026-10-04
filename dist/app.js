'use strict';
const $=id=>document.getElementById(id);
const wave=$('wave'),pen=wave.getContext('2d');
let stream=null,ctx=null,source=null,analyser=null,capture=null,worker=null;
let raf=0,timer=0,modelTimeout=0,analysisTimeout=0,running=false,preview=false,busy=false;
let facing='environment',epoch=0,started=0,lastPaint=0,workerReady=false,analysisBusy=false,requestId=0,lastFrame=0,meterSamples=null,audioOnlySession=false;
let lastResult=false,pendingCandidate=null,requestBoost=false,boostRevision=0,currentWindow=null;
// Session-only device measurements: never includes samples, video, or reason labels.
let deviceStats=null,workerStartedAt=0;
function newDeviceStats(){return {startedAt:performance.now(),endedAt:null,audioRate:null,inputSettings:{},captured:0,waiting:0,busySkipped:0,submitted:0,completed:0,stale:0,latencyTotal:0,latencyMax:0,modelLoadMs:null,failures:{}};}
function deviceFailure(code){if(deviceStats)deviceStats.failures[code]=(deviceStats.failures[code]||0)+1;}
function deviceReport(){
  const d=deviceStats,elapsed=d?Math.max(0,Math.round(((d.endedAt??performance.now())-d.startedAt)/1000)):0;
  return JSON.stringify({app:'응애톡',reportVersion:1,browser:navigator.userAgent||'확인 불가',secureContext:window.isSecureContext,audioWorkletSupported:!!window.AudioWorkletNode,
    session:d?{state:running?'listening':busy?'connecting':'stopped',elapsedSeconds:elapsed,audioContextRate:d.audioRate,inputSettings:d.inputSettings,capturedWindows:d.captured,waitingForModel:d.waiting,skippedWhileBusy:d.busySkipped,submittedWindows:d.submitted,completedResponses:d.completed,staleResults:d.stale,meanResponseMs:d.completed?Math.round(d.latencyTotal/d.completed):null,maxResponseMs:d.completed?Math.round(d.latencyMax):null,latestModelLoadMs:d.modelLoadMs,failures:d.failures}:null,
    limitations:'실제 이 기기의 세션 측정값입니다. 응답 시간에는 최초 모델 다운로드가 포함될 수 있습니다. 울음/원인 정확도, 다른 기기 호환성, 화면 배치는 검증하지 않습니다. 음성·영상·원인 후보는 포함하지 않습니다.'},null,2);
}
function renderDeviceCheck(){
  const d=deviceStats;$('deviceReport').value=deviceReport();
  $('deviceCheckStatus').textContent=!d?'아직 측정 기록이 없어요. 안내를 닫고 듣기를 시작해 주세요.':d.completed>0?`이 기기에서 분석 응답 ${d.completed}개를 받았어요. 정확도 검증 결과는 아니에요.`:d.captured>0?'마이크 구간은 수집됐지만 분석 응답은 아직 없어요.':'마이크 구간 수집 기록이 아직 없어요.';
}
async function copyDeviceReport(){
  renderDeviceCheck();
  try{if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText($('deviceReport').value);$('deviceCopyStatus').textContent='복사했어요. 직접 공유하기 전 내용을 확인해 주세요.';}
  catch{$('deviceReport').focus();$('deviceReport').select();$('deviceCopyStatus').textContent='자동 복사가 지원되지 않아 내용을 선택했어요. 길게 눌러 복사해 주세요.';}
}
function resetResult(){lastResult=false;pendingCandidate=null;clearCandidates();$('candidateDetails').open=false;}
const nextSteps={hungry:'마지막 수유 시간과 입을 오물거리는 신호를 함께 확인해 보세요.',burping:'수유 직후인지, 안아 주었을 때 편안해지는지 살펴보세요.',discomfort:'기저귀와 조이는 옷, 주변 온도를 확인해 보세요.',belly_pain:'몸을 웅크리거나 불편해하는 모습이 있는지 직접 살펴보세요.',lonely:'가까이에서 목소리를 들려주고 반응을 살펴보세요.',scared:'갑작스러운 소리나 밝은 빛이 있었는지 확인해 보세요.'};
const labelNames={belly_pain:'배 불편',burping:'트림',discomfort:'불편함',hungry:'배고픔',lonely:'관심 필요',scared:'놀람'};
// Keep the latest observation separate from the retained historical candidate.
function observation(title,body){$('liveTitle').textContent=title;$('liveBody').textContent=body;}
function result(state,title,body){
  const matched=state==='EXPERIMENTAL MATCH',demo=state==='DEMO · 예시';
  observation(matched?'울음으로 감지했어요':state==='READY TO LISTEN'?(lastResult?'듣기를 마쳤어요':'듣기 전이에요'):title,
    matched?'연속 두 구간에서 같은 후보가 나왔어요.':body);
  $('retainedHint').hidden=!lastResult||matched;
  $('candidateLabel').textContent=lastResult?'마지막 원인 후보':demo?'가상 예시':'원인 후보';
  if(lastResult&&!matched&&!demo){$('modelStatus').textContent=title;return;}
  $('resultState').textContent=state;
  $('resultTitle').textContent=matched||demo?title:'아직 후보가 없어요';
  $('resultBody').textContent=matched||demo?body:'울음이 감지되고 연속 두 구간의 후보가 같을 때 표시해요.';
  $('resultNotice').textContent=matched?'겹치는 구간의 일치 후보이며, 정확도나 실제 원인이 확인된 결과는 아니에요.':'소리만으로 실제 원인을 알 수는 없어요. 아기의 모습과 함께 확인해 주세요.';
}
function clearCandidates(){ $('candidates').replaceChildren();$('candidates').hidden=true;$('candidateDetails').hidden=true;$('analysisMeta').textContent=''; }
function showCandidates(ranked){
  clearCandidates();for(const [index,item] of ranked.slice(0,3).entries()){
    const row=document.createElement('div');row.className='candidate';const order=document.createElement('small');order.textContent=`${index+1}위`;
    const label=document.createElement('strong');label.textContent=(labelNames[item.label]||'알 수 없음');row.append(order,label);$('candidates').append(row);
  }$('candidates').hidden=false;$('candidateDetails').hidden=false;
}
function draw(data){
  const ratio=Math.min(window.devicePixelRatio||1,2),w=wave.clientWidth,h=wave.clientHeight;
  if(wave.width!==Math.round(w*ratio)||wave.height!==Math.round(h*ratio)){wave.width=Math.round(w*ratio);wave.height=Math.round(h*ratio);}
  pen.setTransform(ratio,0,0,ratio,0,0);pen.clearRect(0,0,w,h);pen.strokeStyle='#b68029';pen.lineWidth=2;pen.beginPath();
  for(let x=0;x<w;x++){const v=data?data[Math.floor(x/w*data.length)]:0,y=h/2+v*h*.46;if(!x)pen.moveTo(x,y);else pen.lineTo(x,y);}pen.stroke();
}
function updateClock(){if($('deviceDialog').open)renderDeviceCheck();const secs=Math.floor((performance.now()-started)/1000);$('session').textContent=(preview?'예시':'측정 중')+' · '+String(Math.floor(secs/60)).padStart(2,'0')+':'+String(secs%60).padStart(2,'0');}
function controls(){
  $('empty').disabled=running||busy;$('stop').hidden=!running&&!busy;$('stop').disabled=!running&&!busy;$('demo').disabled=running||busy;$('switch').disabled=!running||preview||busy||audioOnlySession;$('audioOnly').hidden=running||busy;
  $('enableAI').disabled=preview;$('boost').disabled=preview;
}
function stopWorker(){
  clearTimeout(modelTimeout);clearTimeout(analysisTimeout);if(worker)worker.terminate();worker=null;workerReady=false;analysisBusy=false;pendingCandidate=null;currentWindow=null;$('retryAI').hidden=true;
  $('modelStatus').textContent=$('enableAI').checked?'AI 대기 · 카메라 시작 후 연결':'AI 꺼짐';
}
function stop(message='소리 듣기 박스를 눌러 시작해 주세요.'){
  if(deviceStats&&deviceStats.endedAt===null)deviceStats.endedAt=performance.now();if(preview)resetResult();epoch++;running=false;preview=false;busy=false;cancelAnimationFrame(raf);clearInterval(timer);stopWorker();
  if(capture){capture.onprocessorerror=null;capture.port.onmessage=null;capture.port.onmessageerror=null;capture.disconnect();capture=null;}
  if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;
  if(source)source.disconnect();source=null;
  const old=ctx;ctx=null;analyser=null;meterSamples=null;if(old)old.close().catch(()=>{});
  $('micReading').textContent='마이크 연결 전';$('video').srcObject=null;$('empty').style.display='flex';$('cameraStatus').textContent='카메라 꺼짐';$('modeLabel').textContent='영상은 미리보기 · 분석은 소리로만';$('levelText').textContent='마이크 대기';$('meter').style.width='0%';$('session').textContent='준비 중 · 00:00';$('emptyTitle').textContent='아기의 소리를 들려주세요';$('emptyHint').textContent='눌러서 듣기 시작';result('READY TO LISTEN','어떤 소리가 들릴까요?',message);if(lastResult)$('modelStatus').textContent='듣기 종료 · 마지막 후보 표시 중';draw();controls();
}
function captureError(message){deviceFailure('audio-interrupted');stop();$('error').textContent=message;}
function errorText(e){return ({NotAllowedError:'카메라·마이크 권한이 필요해요. 사이트 설정에서 허용해 주세요. 앱 안에서 열었다면 Safari 또는 Chrome에서 열어 주세요.',NotFoundError:'카메라 또는 마이크를 찾지 못했어요.',NotReadableError:'다른 앱이 카메라나 마이크를 사용 중일 수 있어요. 해당 앱을 닫고 다시 시작해 주세요.',OverconstrainedError:'요청한 카메라를 사용할 수 없어요.'})[e.name]||'기기를 시작하지 못했어요. Safari 또는 Chrome에서 다시 열어 주세요.';}
async function start({preserveResult=false,audioOnly=false}={}){
  if(busy||running)return;$('error').textContent='';
  if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){$('error').textContent='보안 연결(HTTPS)의 Safari 또는 Chrome에서 열어 주세요.';return;}
  if(!preserveResult){deviceStats=newDeviceStats();resetResult();result('CONNECTING','소리를 들을 준비를 하고 있어요','브라우저의 마이크 권한을 허용해 주세요.');}busy=true;audioOnlySession=audioOnly;const ticket=++epoch;controls();$('emptyTitle').textContent=audioOnly?'마이크 연결 중':'카메라·마이크 연결 중';$('emptyHint').textContent='권한 요청을 허용해 주세요';
  try{
    const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error('Audio unavailable');
    const ac=new AC();ctx=ac;if(deviceStats){deviceStats.endedAt=null;deviceStats.audioRate=ac.sampleRate??null;}await ac.resume();if(ticket!==epoch)return;
    const audioConstraints={echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1};
    let received;
    try{received=await navigator.mediaDevices.getUserMedia({video:audioOnly?false:{facingMode:{ideal:facing},width:{ideal:640},frameRate:{ideal:15,max:24}},audio:audioConstraints});}
    catch(error){
      if(ticket!==epoch)return;
      if(audioOnly||!['NotFoundError','OverconstrainedError'].includes(error.name))throw error;
      audioOnly=true;audioOnlySession=true;
      $('error').textContent='카메라를 사용할 수 없어 마이크로 연결하고 있어요.';
      received=await navigator.mediaDevices.getUserMedia({video:false,audio:audioConstraints});
      if(ticket===epoch)$('error').textContent='카메라를 사용할 수 없어 소리만 듣고 있어요.';
    }
    if(ticket!==epoch){received.getTracks().forEach(t=>t.stop());return;}stream=received;
    if(deviceStats){const settings=stream.getAudioTracks()[0]?.getSettings?.()||{};deviceStats.inputSettings={};for(const key of ['sampleRate','channelCount','echoCancellation','noiseSuppression','autoGainControl'])if(settings[key]!==undefined)deviceStats.inputSettings[key]=settings[key];}
    if(!audioOnly){
      $('video').srcObject=stream;
      try{await $('video').play();}catch(error){
        if(ticket!==epoch)return;
        stream.getVideoTracks().forEach(track=>track.stop());$('video').srcObject=null;
        audioOnly=true;audioOnlySession=true;
        $('error').textContent='영상 미리보기를 시작하지 못했어요. 소리 분석은 계속할 수 있어요.';
      }
    }if(ticket!==epoch)return;
    analyser=ac.createAnalyser();analyser.fftSize=2048;meterSamples=new Float32Array(analyser.fftSize);source=ac.createMediaStreamSource(stream);source.connect(analyser);
    stream.getTracks().forEach(t=>t.addEventListener('ended',()=>{if(ticket===epoch&&(running||busy))captureError('기기 연결이 끊어졌어요. 다시 시작해 주세요.');}));
    stream.getAudioTracks().forEach(track=>track.addEventListener('mute',()=>{if(ticket===epoch&&(running||busy))captureError('마이크 입력이 중단됐어요. 다른 앱의 마이크 사용을 확인하고 다시 시작해 주세요.');}));
    ac.addEventListener('statechange',()=>{if(ticket===epoch&&running&&(ac.state==='suspended'||ac.state==='interrupted'))captureError('오디오가 중단되어 종료했어요. 다시 시작해 주세요.');});
    running=true;busy=false;started=performance.now();lastPaint=0;lastFrame=0;$('empty').style.display=audioOnly?'flex':'none';$('emptyTitle').textContent='아기의 소리를 듣고 있어요';$('emptyHint').textContent='울음이 들리면 자동으로 분석해요';$('cameraStatus').textContent=audioOnly?'마이크 켜짐':'카메라 · 마이크 켜짐';controls();timer=setInterval(updateClock,1000);updateClock();result('LISTENING','소리를 듣고 있어요','약 3초씩 소리를 분석해요.');tick();
    if(ac.audioWorklet&&window.AudioWorkletNode){
      try{
        await ac.audioWorklet.addModule('audio-capture.js?v=11');if(ticket!==epoch)return;
        capture=new AudioWorkletNode(ac,'cry-capture');source.connect(capture);capture.connect(ac.destination);
        const failed=()=>{if(ticket===epoch&&running)captureError('소리 처리가 중단됐어요. 듣기를 다시 시작해 주세요.');};
        capture.onprocessorerror=failed;capture.port.onmessageerror=failed;
        capture.port.onmessage=({data})=>{
          if(ticket!==epoch||!running)return;
          if(deviceStats)deviceStats.captured++;
          if(!workerReady||!$('enableAI').checked){if(deviceStats)deviceStats.waiting++;return;}
          if(analysisBusy){if(deviceStats)deviceStats.busySkipped++;return;}
          if(!data||!(data.samples instanceof Float32Array)){failed();return;}
          const ageMs=(ctx.currentTime-data.endTime)*1000;
          if(!Number.isInteger(data.sequence)||data.sequence<1||!Number.isFinite(ageMs)||ageMs< -100||ageMs>10000){pendingCandidate=null;return;}
          currentWindow={sequence:data.sequence,at:performance.now()-Math.max(0,ageMs),wallTime:Date.now()-Math.max(0,ageMs),sentAt:performance.now(),boostRevision};
          analysisBusy=true;requestBoost=$('boost').checked;const id=++requestId;
          $('modelStatus').textContent='소리 종류 확인 중 · 약 3초 구간';
          try{worker.postMessage({type:'analyze',id,...data,boost:$('boost').checked},[data.samples.buffer]);if(deviceStats)deviceStats.submitted++;}
          catch(error){modelError('소리를 분석기로 전달하지 못했어요. 다시 연결해 주세요.');return;}
          analysisTimeout=setTimeout(()=>{if(ticket===epoch)modelError('분석이 지연됐어요. 다시 연결해 주세요.');},20000);
        };
        if($('enableAI').checked)startWorker();
      }catch(e){if(ticket===epoch)modelError('이 브라우저에서는 실시간 AI 분석을 시작하지 못했어요. Safari 또는 Chrome에서 다시 열어 주세요.');}
    }else modelError('이 브라우저는 실시간 AI 분석을 지원하지 않아요. 영상과 소리 크기만 표시해요.');
  }catch(e){if(ticket!==epoch)return;deviceFailure('device-start-failed');stop();$('error').textContent=errorText(e);}
}
function modelError(message){deviceFailure('analysis-failed');stopWorker();result('AI UNAVAILABLE','AI 분석이 중단됐어요','영상과 소리 크기는 계속 확인할 수 있어요.');$('modelStatus').textContent=message;$('retryAI').hidden=!running||!capture;}
function startWorker(){
  stopWorker();if(!running||preview||!$('enableAI').checked)return;
  if(!capture){$('modelStatus').textContent='오디오 연결을 준비하고 있어요';return;}
  const ticket=epoch;
  try{
    workerStartedAt=performance.now();const current=new Worker('analysis-worker.js?v=12');worker=current;$('modelStatus').textContent='울음 감지 준비 중 · 최초 약 11MB';
    result('MODEL LOADING','AI를 준비하고 있어요','처음에는 잠시 걸릴 수 있어요.');
    const active=()=>ticket===epoch&&worker===current&&running&&$('enableAI').checked;
    current.onerror=()=>{if(active())modelError('AI 연결에 실패했어요. 다시 연결해 주세요.');};
    current.onmessageerror=()=>{if(active())modelError('분석 응답을 받지 못했어요. 다시 연결해 주세요.');};
    current.onmessage=({data})=>{
      if(!active())return;
      if(!data||typeof data!=='object'){modelError('분석 응답을 읽지 못했어요. 다시 연결해 주세요.');return;}
      if(data.type==='progress'){if(data.stage==='reason-loading'&&data.id===requestId&&analysisBusy){clearTimeout(analysisTimeout);analysisTimeout=setTimeout(()=>{if(active())modelError('원인 모델을 내려받지 못했어요. 다시 연결해 주세요.');},90000);$('modelStatus').textContent='원인 모델 준비 중 · 최초 약 8MB';observation('울음으로 감지했어요','원인 후보를 비교할 준비를 하고 있어요.');}else if(data.stage==='reason'&&data.id===requestId){$('modelStatus').textContent='원인 후보 비교 중';observation('울음으로 감지했어요','학습된 소리와 비교하고 있어요.');}else if(data.stage==='download'){$('modelStatus').textContent='울음 감지 모델을 내려받고 있어요';}else if(data.stage==='detector'){$('modelStatus').textContent='울음 감지 기능을 시작하고 있어요';}return;}
      if(data.type==='ready'){if(deviceStats)deviceStats.modelLoadMs=Math.round(performance.now()-workerStartedAt);clearTimeout(modelTimeout);workerReady=true;$('modelStatus').textContent='AI 준비 완료 · 소리 수집 중';result('AI LISTENING','울음 소리를 모으고 있어요','약 3초의 소리가 모이면 울음인지 먼저 확인해요.');return;}
      if(data.type==='error'){modelError('AI 분석을 완료하지 못했어요. 다시 연결해 주세요.');return;}
      if(data.type!=='result'||data.id!==requestId||!analysisBusy)return;
      if(deviceStats&&currentWindow){const latency=Math.max(0,performance.now()-currentWindow.sentAt);deviceStats.completed++;deviceStats.latencyTotal+=latency;deviceStats.latencyMax=Math.max(deviceStats.latencyMax,latency);}clearTimeout(analysisTimeout);analysisBusy=false;if(!currentWindow||requestBoost!==$('boost').checked||currentWindow.boostRevision!==boostRevision){pendingCandidate=null;return;}
      if(performance.now()-currentWindow.at>10000){if(deviceStats)deviceStats.stale++;pendingCandidate=null;result('STALE WINDOW','새 소리를 기다리고 있어요','준비 중 수집한 오래된 소리는 건너뛰고 다시 들어요.');return;}$('modelStatus').textContent='AI 켜짐 · 다음 구간 기다리는 중';
      const statuses={quiet:['분석할 소리를 기다리고 있어요',$('boost').checked?'울음이 들리면 자동으로 분석해요.':'작은 소리 자동 보정을 켜거나 마이크가 가려졌는지 확인해 주세요.'],clipped:['소리가 찌그러지고 있어요','마이크에 소리가 너무 크게 들어와 분석을 보류했어요.'],noise:['소음이 많이 섞여 있어요','울음 라벨과 비교하기 어려워 분석을 보류했어요.']};
      if(statuses[data.status]){pendingCandidate=null;result('ANALYSIS PAUSED',...statuses[data.status]);return;}
      if(data.status==='not_cry'||data.status==='cry_unconfirmed'){
        pendingCandidate=null;
        const soundNames={0:'말소리',1:'아이 말소리',2:'대화',4:'옹알이',13:'웃음',14:'아기 웃음',19:'울음',69:'강아지 소리',70:'짖는 소리',132:'음악',371:'청소기 소리',494:'무음',507:'잡음',514:'백색 소음',518:'TV 소리'};
        if(data.status==='not_cry'){const name=soundNames[data.soundIndex];result('OTHER SOUND',name?`${name}에 가까워요`:'울음 외의 소리로 감지됐어요','소리가 계속되면 다시 확인할게요. 실제 울음도 놓칠 수 있어요.');}
        else{result('CHECKING FOR CRY','울음인지 확인하고 있어요','조금 더 들어볼게요.');}
        return;
      }
      if(data.status!=='classified'||!Array.isArray(data.ranked)){modelError('분석 결과를 읽지 못했어요.');return;}

      const ranked=data.ranked;
      if(ranked.length<2||typeof data.uncertain!=='boolean'||ranked.some(x=>!x||!labelNames[x.label]||!Number.isFinite(x.score)||x.score<0||x.score>1)||new Set(ranked.map(x=>x.label)).size!==ranked.length||ranked.some((x,i)=>i&&x.score>ranked[i-1].score)){modelError('분석 결과를 읽지 못했어요.');return;}
      const top=ranked[0];
      // Overlapping-window agreement is a stability heuristic, not independent
      // evidence or a validated improvement in accuracy.
      if(data.uncertain||top.score<.55||top.score-ranked[1].score<.15){
        pendingCandidate=null;
        result('UNCERTAIN · 불확실','아직 원인을 구분하기 어려워요','울음은 감지됐지만 뚜렷한 후보가 없어요.');
        return;
      }
      const repeated=pendingCandidate&&pendingCandidate.label===top.label&&currentWindow.sequence===pendingCandidate.sequence+1&&currentWindow.at-pendingCandidate.at<=10000;
      pendingCandidate={label:top.label,at:currentWindow.at,sequence:currentWindow.sequence};
      if(!repeated){result('CHECKING CANDIDATE','울음 감지 · 후보 확인 중','다음 구간에서도 같은 후보인지 확인해요.');return;}
      showCandidates(ranked);lastResult=true;
      result('EXPERIMENTAL MATCH',`${labelNames[top.label]} 후보`,nextSteps[top.label]);
      $('analysisMeta').textContent=`마지막 소리 수집 · ${new Date(currentWindow.wallTime).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;

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
  raf=requestAnimationFrame(tick);if(now-lastFrame<50)return;lastFrame=now;
  const samples=meterSamples;analyser.getFloatTimeDomainData(samples);
  let sum=0;for(const s of samples)sum+=s*s;const db=20*Math.log10(Math.max(Math.sqrt(sum/samples.length),.00001));const level=Math.min(100,Math.max(0,(db+65)/55*100));
  draw(samples);$('meter').style.width=level+'%';
  if(now-lastPaint>400){lastPaint=now;$('levelText').textContent=level<8?'작은 소리 입력':level<55?'소리가 들려요':'비교적 큰 소리';$('micReading').textContent=`입력 ${Math.round(db)} dBFS`;}
}
function switchCamera(){if(!running||preview||busy)return;facing=facing==='environment'?'user':'environment';stop();start({preserveResult:true});}
function demo(){
  if(running||busy)return;resetResult();preview=true;running=true;started=performance.now();$('error').textContent='';$('cameraStatus').textContent='예시 · 실제 카메라 아님';$('modeLabel').textContent='DEMO · 예시 화면';$('empty').style.display='flex';$('levelText').textContent='예시 파형';$('modelStatus').textContent='예시 · 모델 실행 안 함';
  result('DEMO · 예시','배고픔 라벨과 비슷해요','이 화면은 가상 예시이며, 실제 아기의 소리를 분석한 결과가 아니에요.');showCandidates([{label:'hungry'},{label:'discomfort'},{label:'burping'}]);$('analysisMeta').textContent='가상 예시 · 실제 분석 아님';$('emptyTitle').textContent='예시 화면';$('emptyHint').textContent='실제 녹음이나 분석이 아니에요';controls();timer=setInterval(updateClock,1000);updateClock();
  function frame(t){if(!preview)return;draw(Float32Array.from({length:512},(_,i)=>Math.sin(i*.14+t*.004)*Math.sin(i*.027)*.5));$('meter').style.width=(45+Math.sin(t*.002)*15)+'%';raf=requestAnimationFrame(frame);}raf=requestAnimationFrame(frame);
}
function context(){const feed=$('feed').value,sleep=$('sleep').value;let title='아기의 표정과 주변 환경',body='소리만으로 원인을 정할 수 없어요. 아기를 직접 살펴보며 필요한 것을 확인해 주세요.';if(sleep==='hungry'||feed==='long'){title='수유가 필요한지 살펴봐 주세요';body='선택한 수유 간격이나 행동을 바탕으로 한 안내예요. 평소 수유 패턴과 지금 보이는 먹고 싶어 하는 신호를 함께 확인해 주세요.';}if(sleep==='tired'){title='졸린 모습인지 살펴봐 주세요';body='하품·눈 비빔을 선택하셨어요. 마지막 잠에서 깬 시간과 주변 빛·소음을 함께 확인해 보세요.';}if(sleep==='uncomfortable'){title='기저귀와 옷, 주변을 확인해 주세요';body='불편해 보이는 모습을 선택하셨어요. 젖은 기저귀나 조이는 옷이 있는지 직접 확인해 보세요.';}$('suggestTitle').textContent=title;$('suggestBody').textContent=body;}
$('deviceCheck').onclick=()=>{renderDeviceCheck();$('deviceCopyStatus').textContent='';$('deviceDialog').showModal();};$('closeDeviceCheck').onclick=()=>$('deviceDialog').close();$('refreshDeviceCheck').onclick=renderDeviceCheck;$('copyDeviceCheck').onclick=copyDeviceReport;
$('empty').onclick=start;$('stop').onclick=()=>stop();$('switch').onclick=switchCamera;$('demo').onclick=demo;$('enableAI').onchange=toggleAI;$('retryAI').onclick=()=>{$('enableAI').checked=true;startWorker();};$('boost').onchange=()=>{boostRevision++;pendingCandidate=null;};$('audioOnly').onclick=()=>start({audioOnly:true});$('feed').onchange=context;$('sleep').onchange=context;$('checkContext').onclick=()=>{$('contextPanel').open=true;$('contextSummary').focus();};$('verification').onclick=()=>$('aboutDialog').showModal();$('about').onclick=()=>$('aboutDialog').showModal();$('closeAbout').onclick=()=>$('aboutDialog').close();
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(running||busy))stop('화면을 벗어나 측정을 종료했어요. 다시 시작해 주세요.');});window.addEventListener('pagehide',()=>stop());window.addEventListener('resize',()=>{if(!running)draw();});draw();
if(document.modelContext?.registerTool){const lifecycle=new AbortController();try{Promise.resolve(document.modelContext.registerTool({name:'read_sound_session',title:'소리 관찰 상태 확인',description:'현재 화면의 관찰 상태와 실험 AI 연결 여부를 읽습니다. 녹음이나 카메라를 시작하지 않습니다.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length)throw new Error('입력은 빈 객체여야 합니다.');return{running,demo:preview,status:$('resultTitle').textContent,observation:$('liveTitle').textContent,lastCandidateCapturedAt:$('analysisMeta').textContent,contextSuggestion:$('suggestTitle').textContent,experimentalAIEnabled:$('enableAI').checked,modelReady:workerReady,validatedCryTranslationAvailable:false};}},{signal:lifecycle.signal})).catch(()=>{});}catch{}window.addEventListener('pagehide',()=>lifecycle.abort());}
