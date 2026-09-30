const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const models = [
  ['reason-v0.6.bin', 'https://huggingface.co/manfye/baby-cry-reasoning/resolve/a3e1a3222ab1c813bb6dc588e83c3e9c620b4542/reason-v0.6.bin', '17dcfff76704f433ca6bbf25430c75691f280715e8591615fb782995197b7edc'],
  ['yamnet.tflite', 'https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/latest/yamnet.tflite', '4d8b4a53282dc83ef04e3e7dbc4fbc98082e34e44ed798e16c3a0cdd4c584faf'],
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
(async () => {
  await fs.mkdir(path.join(root, 'dist/models'), { recursive: true });
  for (const [name, url, expected] of models) {
    const target = path.join(root, 'dist/models', name);
    try { if (hash(await fs.readFile(target)) === expected) continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    console.log('Downloading ' + name);
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(name + ': HTTP ' + response.status);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== expected) throw new Error(name + ': SHA-256 mismatch; refusing unverified model');
    await fs.writeFile(target + '.tmp', bytes);
    await fs.rename(target + '.tmp', target);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
