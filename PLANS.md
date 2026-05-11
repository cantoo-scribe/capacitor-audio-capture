# Capacitor v7 plugin — Audio Capture

## Scope
Plugin with API: `startCapture(options?)`, `stopCapture()`, `release()`.
Stream of **raw PCM** mono samples delivered as `Float32Array` via a JS
listener; Web/Android/iOS. The bridge transports the chunks as base64 for
efficiency; the wrapper decodes once before invoking the listener. No
format conversion or compression inside the plugin — the consumer decides
what to do with the samples.

## `startCapture` options
- `chunkDurationMs: number` — duration of each emitted chunk
- `targetSampleRate: number` — target sample rate (resampled if needed)
- `silenceThreshold: number` — RMS below which a chunk is treated as silence
- `listener?: (sequence: number, chunk: Float32Array) => void`

## Bridge strategy
Native → JS via `notifyListeners('audioChunk', { sequence, data })` where
`data` is base64 (little-endian Float32 PCM). The JS wrapper decodes the
base64 once into a `Float32Array` before invoking the consumer's
`listener`.

## Components
- `src/definitions.ts` — public/native interfaces, types.
- `src/index.ts` — JS wrapper. Registers an internal `addListener` and
  routes events to the user-provided `listener`.
- `src/web.ts` — Web platform implementation using `getUserMedia` +
  `AudioWorklet`.
- `src/audio-worklet.ts` — DSP processor (resample, silence detection,
  buffering) running off the main thread.
- `android/src/main/.../{AudioCapturePlugin,AudioCapture}.java` — Android
  implementation using `AudioRecord` on a dedicated thread.
- `ios/Sources/AudioCapturePlugin/{AudioCapturePlugin,AudioCapture}.swift`
  — iOS implementation using `AVAudioEngine.installTap` on a dedicated
  dispatch queue.
- `scripts/inline-workers.mjs` — build-time helper that bundles the
  worklet and inlines it as a string into `dist/esm/web.js`.

## Decisions
- Audio captured as Float32 mono. Resampling via linear interpolation.
- Silence detection via per-chunk RMS (amplitude threshold 0..1).
- Monotonic sequence per capture session, resets on each `startCapture`.
  Continues to advance even for silenced chunks so consumers can detect
  temporal gaps.
- `release` frees resources (engine/threads/listeners) so the plugin can
  be reused.

## Status
Complete.
