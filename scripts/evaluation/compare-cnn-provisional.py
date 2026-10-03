# RESEARCH ONLY: reference frontend parity has not been established.
import json,hashlib,time
from pathlib import Path
import numpy as np
import onnxruntime as ort
import argparse
parser=argparse.ArgumentParser()
parser.add_argument('study_directory',type=Path)
root=parser.parse_args().study_directory.resolve()
root.mkdir(parents=True,exist_ok=True)
meta=json.loads((root/'model-metadata.json').read_text());task=meta['tasks']['detection']
assert hashlib.sha256((root/'detection.onnx').read_bytes()).hexdigest()==task['model_sha256']
session=ort.InferenceSession(str(root/'detection.onnx'),providers=['CPUExecutionProvider'])
hz=lambda m:700*(10**(m/2595)-1)
points=hz(np.linspace(2595*np.log10(1+50/700),2595*np.log10(1+8000/700),66))
freq=np.arange(257)*16000/512
filters=np.maximum(0,np.minimum((freq[None,:]-points[:-2,None])/(points[1:-1,None]-points[:-2,None]),(points[2:,None]-freq[None,:])/(points[2:,None]-points[1:-1,None])))
window=.5-.5*np.cos(2*np.pi*np.arange(400)/400)
mean=np.array(task['feature_mean'])[:,:,None];std=np.array(task['feature_std'])[:,:,None]
rows=[]
for file in sorted((root/'fixtures').glob('*.f32')):
 x=np.fromfile(file,dtype='<f4').astype('float64');clipped=np.mean(np.abs(x)>.985);x-=x.mean();rms=np.sqrt(np.mean(x*x));db=20*np.log10(max(rms,1e-12));crossings=np.mean(np.signbit(x[1:])!=np.signbit(x[:-1]));status='ready'
 if clipped>.01:status='clipped'
 elif db< -65:status='quiet'
 elif crossings>.4:status='noise'
 row={'file':file.name,'preprocessing':status}
 if status=='ready':
  gain=min(max(10**((-23-db)/20),10**(-12/20)),10**(36/20),10**(-1/20)/max(np.max(np.abs(x)),1e-12));x*=gain
  x=np.r_[x[0],x[1:]-.97*x[:-1]]
  frames=np.lib.stride_tricks.sliding_window_view(x,400)[::160]
  power=np.abs(np.fft.rfft(frames*window,n=512)/window.sum())**2
  mel=np.log(np.maximum(filters@power.T,1e-6));delta=np.gradient(mel,axis=1);features=np.stack([mel,delta,np.gradient(delta,axis=1)])
  values=((features-mean)/np.maximum(std,1e-6)).astype('float32')[None]
  start=time.perf_counter();logits=session.run(None,{'features':values})[0][0];elapsed=(time.perf_counter()-start)*1000
  probability=np.exp(logits-logits.max());probability/=probability.sum()
  row.update(cryScore=float(probability[0]),decision='cry' if probability[0]>=.5 else 'non_cry',inferenceMs=elapsed)
 rows.append(row)
report={'modelRevision':'4495440c7aeb0b04f12b9b991df5d92c062f92a0','modelSha256':task['model_sha256'],'status':'RESEARCH_ONLY_NOT_PARITY_VERIFIED','frontendAssumptions':['Uncentered 400-sample Hann STFT, 160 hop, FFT512','FFT divided by window sum before power','First-order numpy gradient, one-sided edges','Per-channel/per-mel normalization from published metadata','Application audio gate matches current boosted mode'],'limitations':'Published metadata omits STFT scaling, centering and delta formula. This provisional frontend is not a validated reproduction. Results cannot justify production replacement. Training overlap with ESC-50 is unknown.','rows':rows}
(root/'cnn-provisional.json').write_text(json.dumps(report,indent=2))
for cry in [True,False]:
 selected=[r for r in rows if r['file'].startswith('crying_baby')==cry]
 print('cry' if cry else 'noncry',len(selected),'cry predictions',sum(r.get('decision')=='cry' for r in selected))
