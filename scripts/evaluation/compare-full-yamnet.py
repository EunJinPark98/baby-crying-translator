import json,time,hashlib
from pathlib import Path
import numpy as np
from ai_edge_litert.interpreter import Interpreter
import argparse
parser=argparse.ArgumentParser()
parser.add_argument('study_directory',type=Path)
root=parser.parse_args().study_directory.resolve()
assert hashlib.sha256((root/'yamnet-full.tflite').read_bytes()).hexdigest()=='141fba1cdaae842c816f28edc4937e8b4f0af4c8df21862ccc6b52dc567993c3'
model=Interpreter(model_path=str(root/'yamnet-full.tflite'),num_threads=2)
model.resize_tensor_input(model.get_input_details()[0]['index'],[15600]);model.allocate_tensors()
input_index=model.get_input_details()[0]['index'];output_index=model.get_output_details()[0]['index']
rows=[]
for file in sorted((root/'fixtures').glob('*.f32')):
 x=np.fromfile(file,dtype='<f4').copy();clip=np.mean(np.abs(x)>.985);x=(x-x.astype('float64').mean()).astype('float32');db=20*np.log10(max(np.sqrt(np.mean(x.astype('float64')**2)),1e-12));cross=np.mean(np.signbit(x[1:])!=np.signbit(x[:-1]));status='ready'
 if clip>.01:status='clipped'
 elif db< -65:status='quiet'
 elif cross>.4:status='noise'
 row={'file':file.name,'preprocessing':status}
 if status=='ready':
  gain=min(max(10**((-23-db)/20),10**(-12/20)),10**(36/20),10**(-1/20)/max(np.max(np.abs(x)),1e-12));x=(x*gain).astype('float32');scores=[]
  start=time.perf_counter()
  for offset in [0,15600,31200]:model.set_tensor(input_index,x[offset:offset+15600]);model.invoke();scores.append(model.get_tensor(output_index)[0])
  scores=np.array(scores);cry=scores[:,20];speech=np.max(scores[:,:3],axis=1);music=scores[:,132];competing=max(speech.mean(),music.mean())>.25 and max(speech.mean(),music.mean())>cry.mean()*1.2
  detected=not competing and cry.mean()>=.2 and (np.sum((cry>=.2)&(cry>=speech)&(cry>=music))>=2 or cry.max()>=.75)
  row.update(decision='cry' if detected else ('not_cry' if cry.max()<.1 and scores.mean(axis=0).max()>=.2 else 'unconfirmed'),cryScore=float(cry.mean()),peak=float(cry.max()),inferenceMs=(time.perf_counter()-start)*1000)
 rows.append(row)
summary={}
for actual in ['cry','noncry']:
 selected=[r for r in rows if r['file'].startswith('crying_baby')==(actual=='cry')];summary[actual]={'windows':len(selected),'cryPredictions':sum(r.get('decision')=='cry' for r in selected)}
(root/'full-yamnet.json').write_text(json.dumps({'source':'https://www.kaggle.com/models/google/yamnet/tfLite/tflite/1','sha256':hashlib.sha256((root/'yamnet-full.tflite').read_bytes()).hexdigest(),'comparison':'Same three 15600-sample frames, gate and prepared 16kHz audio. Python float32 frontend; not a browser integration test.','summary':summary,'rows':rows},indent=2));print(summary)
