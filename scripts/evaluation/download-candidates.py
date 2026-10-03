"""Download public research candidates only. Never called by the application build."""
import argparse,urllib.request,hashlib,io,tarfile
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('study_directory',type=Path)
root=parser.parse_args().study_directory.resolve();root.mkdir(parents=True,exist_ok=True)
def get(url):
 with urllib.request.urlopen(url,timeout=60) as response:return response.read()
base='https://huggingface.co/manfye/baby-cry-detector/resolve/4495440c7aeb0b04f12b9b991df5d92c062f92a0/'
for name in ['README.md','model-metadata.json','detection.onnx']:
 data=get(base+name)
 if name=='detection.onnx':assert hashlib.sha256(data).hexdigest()=='654dd85892bc3f0eccfecdfa8c2466a1b42c22631fbf90629355bf72bf74526b'
 (root/name).write_bytes(data)
archive=get('https://www.kaggle.com/api/v1/models/google/yamnet/tfLite/tflite/1/download')
with tarfile.open(fileobj=io.BytesIO(archive)) as bundle:
 data=bundle.extractfile('1.tflite').read()
 assert hashlib.sha256(data).hexdigest()=='141fba1cdaae842c816f28edc4937e8b4f0af4c8df21862ccc6b52dc567993c3'
 (root/'yamnet-full.tflite').write_bytes(data)
print('Verified research candidate weights; no application assets changed.')
