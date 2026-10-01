# 응애톡 — 아기 울음 번역기

Static, private Sites application for local camera/audio observation and optional
experimental cry-label similarity. The model cannot reliably translate an
individual baby's needs. YAMNet screens for baby crying before experimental reason-label matching.
This screening can miss crying and mistake recorded or mixed sounds for crying.

Tap the listening panel to enable camera/microphone and begin analysis.
Analysis and quiet-input compensation default to on; optional controls are
collapsed under settings. Audio stays in memory and is not saved as a recording.

## Develop

- `npm ci`
- `npm run build` (downloads SHA-256-verified models, bundles the worker and copies pinned MediaPipe WASM)
- `npm run check`
- `node scripts/test-analysis.cjs`
- `node scripts/test-lifecycle.cjs`
- `node scripts/test-worker-runtime.cjs` (runs the shipped WASM and both actual models)

Serve `dist` over HTTPS or localhost for camera and AudioWorklet support.
No API key is needed; camera frames and audio do not leave the browser.
GitHub tracks source and static UI assets. Model binaries and generated worker/WASM
are recreated by `npm run build`; model hashes and runtime versions are pinned.
Node.js 22 and network access to npm, Hugging Face and Google Storage are required.

## Pipeline

A muted video preview and AudioWorklet capture mono 3.072 s windows with 1.536 s hops. The user
explicitly enables experimental analysis. Windows are
linearly resampled to 16 kHz, DC-removed, quality-gated and normalized to -23 dBFS, then screened by YAMNet using three complete 0.975-second frames. Only cry-positive
windows proceed to the upstream 217-feature extractor and 1000-tree
Extra Trees runtime inside a dedicated Worker. Overlapping inference is dropped,
not queued. Switching away/ending the session stops tracks and terminates the worker.

Quiet-input compensation is enabled by default. It extends the upstream 12 dB gain
cap to 36 dB and lowers the input gate from -50 to -65 dBFS. This is a frontend
adaptation, not a new model or proven accuracy improvement. Noise/clipping gates remain.

The application marks results uncertain below a top score of .55 or a top-two margin of .15.
Uncertain windows do not publish a new reason. Two consecutive qualified windows
within 10 seconds must agree on the top label before replacing the last candidate.
Overlapping windows are correlated: this reduces flicker, not proven model error.
Silence, noise and ambiguity reset pending agreement but preserve the last displayed
candidate and its original timestamp. Stopping also retains it; a new session,
demo or page reload clears it. Current listening status is shown separately.
These are conservative UI heuristics, not calibrated probabilities. Scores are
not displayed as confidence or accuracy. There is no sleepiness class.

## Provenance

See `dist/licenses/NOTICE.txt`, the included upstream model card, original runtime
source and license links. Model SHA-256 is checked during startup and testing.
The model is research/testing-only with no untouched compatible final holdout.
Do not use outputs for caregiving decisions, medical diagnosis or safety monitoring.

## Verification limits

Automated tests exercise actual model weights with synthetic audio at 16/44.1/48kHz,
quality gates, capture window length, lifecycle cancellation and stale-result handling.
They do not establish clinical accuracy or real infant classification quality.
Physical iPhone camera permissions, autoplay and performance still require device QA.

## Brand

응애톡 — 아기 울음 번역기, by 별마마파파. Light cream and warm gold UI,
a service-only 응애톡 header, and a centered brand footer inspired by 별빛초대장.
The footer links to the official brand homepage, Instagram and Kakao channel.
Reference: https://letter.byeolmamapapa.com/.

## GitHub target

Requested repository: https://github.com/EunJinPark98/baby-crying-translator.
Sites publication and GitHub are separate remotes; publishing a Site does not
automatically upload to GitHub.

## Latest validation

See [2026-10-01 validation](docs/VALIDATION.md) for recorded cry/non-cry smoke cases,
missed crying, reproducibility hashes and browser QA limits. No accuracy improvement is claimed.
