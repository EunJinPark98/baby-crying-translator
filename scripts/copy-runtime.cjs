const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'dist/vendor/mediapipe');
fs.mkdirSync(target, { recursive: true });
for (const name of ['audio_wasm_internal.js','audio_wasm_internal.wasm','audio_wasm_nosimd_internal.js','audio_wasm_nosimd_internal.wasm']) {
  fs.copyFileSync(path.join(root, 'node_modules/@mediapipe/tasks-audio/wasm', name), path.join(target, name));
}
