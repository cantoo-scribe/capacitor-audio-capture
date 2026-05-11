# Architectural decisions

## 1. Bridge transport (native): base64. Web: `Float32Array` direct.
Capacitor's native↔JS bridge only carries JSON-serializable values, so on
iOS/Android the chunk is shipped as base64-encoded little-endian Float32
PCM. Base64 is ~33% smaller and dramatically faster to
serialize/deserialize than a JSON number array of thousands of numbers.

On web there is no bridge serialization — `notifyListeners` dispatches an
event in-process. Forcing a `Float32Array → base64 → Float32Array`
round-trip there would be pure waste, so the web implementation passes the
`Float32Array` straight through.

The wrapper normalizes both shapes: if `event.data` is a string it decodes
base64 once; if it's a typed array it uses it as-is. Either way, the
consumer's `listener` receives a `Float32Array` of mono samples in
`[-1, 1]` — the natural representation for audio work (Web Audio, DSP,
visualizers, WAV building).

## 2. No format conversion / compression inside the plugin
The plugin captures audio, resamples it to `targetSampleRate`, optionally
filters silence, and emits raw PCM (base64). Encoding to WAV, MP3, Opus,
etc. is the consumer's responsibility. Reasons:
- Keeps the plugin small and dependency-free.
- Avoids dragging native codec libraries (LAME requires
  CocoaPods/JitPack/NDK) and avoids shipping JS-side encoders that compete
  with the main thread on capture.
- Lets the app choose the codec/bitrate appropriate for its target
  (e.g., direct upload to STT services, on-device storage, real-time
  streaming).

## 3. Listener as a property of `startCapture`, adapted internally
The requested API exposes `listener` on the options object. Since functions
don't cross the bridge, JS strips the `listener`, registers an internal
`addListener('audioChunk', …)`, and drops the property before calling
native. `stopCapture` and `release` remove that subscription.

## 4. Web: `AudioWorklet` with the processor inlined via Blob URL
DSP (resample, silence detection, buffering) runs on the audio rendering
thread, not the main thread. The processor lives in `src/audio-worklet.ts`
(properly type-checked TypeScript) and is bundled to IIFE at build time,
then inlined as a string into `dist/esm/web.js` via a placeholder. At
runtime it is loaded via `URL.createObjectURL(new Blob([src]))` — no extra
file needs to be served by the host application. Chunk buffers are
transferred (zero-copy) from the worklet to the main thread, which only
does base64 + `notifyListeners`.

## 5. Resampling: linear interpolation
Good enough for voice / ASR, cheap, and tiny state (a single sample
"carry" between calls). For demanding cases consider polyphase/SRC.

## 6. iOS: `AVAudioEngine.installTap` at the native format
Capture happens at the hardware's natural format and is resampled to
`targetSampleRate` via the same linear-interpolation algorithm as Web and
Android, keeping behavior consistent across platforms.

## 7. Android: `AudioSource.VOICE_RECOGNITION` @ 44.1 kHz PCM 16-bit
Good voice quality, low latency, broad device compatibility. Conversion
to Float32 mono and resampling happen on a dedicated thread.

## 8. RMS-based silence detection, with sequence still advancing
Even when a chunk is silenced, `sequence` is incremented so consumers can
detect temporal gaps (handy for timestamps in ASR).

## 9. Build pipeline for worker-like assets
`scripts/inline-workers.mjs` operates on a uniform task list for any
"worker-like" code (currently only the AudioWorklet) that needs to run off
the main thread:

1. `tsc` compiles the worker's TypeScript source to `dist/esm/<name>.js`.
2. The script uses the Rollup API to bundle the compiled JS + dependencies
   into a single IIFE (resolving `node_modules` via `nodeResolve` +
   `commonjs`).
3. The IIFE is injected as a string into the matching placeholder in the
   target file.
4. The standalone worker artifacts are removed from `dist`.
5. Rollup produces the final IIFE/CJS bundles from `dist/esm/index.js`.

The pattern is table-driven so future worker-like assets (if ever needed)
add as a single entry without touching the pipeline.
