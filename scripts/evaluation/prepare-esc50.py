from pathlib import Path
import urllib.request,csv,io,concurrent.futures,json,hashlib,wave
import numpy as np
from scipy.signal import resample_poly
import argparse
parser=argparse.ArgumentParser()
parser.add_argument('study_directory',type=Path)
root=parser.parse_args().study_directory.resolve()
root.mkdir(parents=True,exist_ok=True)
revision='33c8ce9eb2cf0b1c2f8bcf322eb349b6be34dbb6'
base=f'https://raw.githubusercontent.com/karolpiczak/ESC-50/{revision}/'
def fetch(url):
 with urllib.request.urlopen(url,timeout=45) as r:return r.read()
rows=list(csv.DictReader(io.StringIO(fetch(base+'meta/esc50.csv').decode())))
# Fixed selection before evaluation: all cries, first 8 filenames per distractor class.
classes=['laughing','cat','dog','coughing','breathing','snoring','clock_alarm','vacuum_cleaner','washing_machine','crying_baby']
selected=[]
for category in classes:
 group=sorted((r for r in rows if r['category']==category),key=lambda r:r['filename'])
 selected.extend(group if category=='crying_baby' else group[:8])
(root/'audio').mkdir(exist_ok=True);(root/'fixtures').mkdir(exist_ok=True)
def one(row):
 name=row['filename'];dest=root/'audio'/name
 if not dest.exists():dest.write_bytes(fetch(base+'audio/'+name))
 raw=dest.read_bytes()
 with wave.open(io.BytesIO(raw)) as w:
  assert w.getsampwidth()==2 and w.getnchannels()==1
  rate=w.getframerate();audio=np.frombuffer(w.readframes(w.getnframes()),dtype='<i2').astype(np.float64)/32768
 for offset in [0,1.5]:
  # Band-limited resampling: dataset preparation, not browser microphone preprocessing.
  from math import gcd
  factor=gcd(rate,16000);mono=resample_poly(audio,16000//factor,rate//factor)
  clip=mono[round(offset*16000):round(offset*16000)+49152].astype('<f4')
  (root/'fixtures'/f"{row['category']}-{name[:-4]}-{offset}.f32").write_bytes(clip.tobytes())
 return {**row,'sha256':hashlib.sha256(raw).hexdigest(),'sourceUrl':base+'audio/'+name}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:manifest=list(pool.map(one,selected))
(root/'sources.json').write_text(json.dumps({'revision':revision,'selection':'All 40 crying_baby; first eight sorted filenames from nine distractor classes, selected before inference. Two overlapping windows per recording.','files':manifest},indent=2))
print('Prepared',len(manifest),'recordings and',len(manifest)*2,'windows')
