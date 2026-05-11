# Changelog

All notable changes to this package are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/);
versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Normalized error codes across web, Android, and iOS. Every rejected
  Promise from the plugin now carries `.code` from a closed set:
  `PERMISSION_DENIED`, `MICROPHONE_UNAVAILABLE`, `ALREADY_CAPTURING`,
  `UNAVAILABLE` (web only), or `INTERNAL_ERROR`. Exported as
  `AudioCaptureErrorCode` / `AudioCaptureError` from the package root.
  Consumers should branch on `.code` rather than match messages.
  - iOS: typed `AudioCaptureNativeError` for in-progress detection;
    AVFoundation / OSStatus errors map to `MICROPHONE_UNAVAILABLE`.
  - Android: `mapErrorCode(Throwable)` maps `SecurityException` and
    `IllegalStateException` variants; rejects use the `(message, code,
    throwable)` form.
  - Web: `getUserMedia` `DOMException` names map to `PERMISSION_DENIED`
    (`NotAllowedError` / `SecurityError`) or `MICROPHONE_UNAVAILABLE`
    (`NotFoundError` / `OverconstrainedError` / `NotReadableError` /
    `AbortError`). `getUserMedia` / `AudioWorklet` capability misses use
    `UNAVAILABLE`.

### Fixed
- `stopCapture()` now flushes the residual chunk on all platforms. Previously
  any audio buffered after the last full chunk emission (up to
  `chunkDurationMs - 1 sample` of audio, ~1 s with the default) was silently
  discarded. The flush respects `silenceThreshold` and keeps `sequence`
  monotonic. `release()` inherits the flush by calling `stopCapture` first.
  - iOS: drains the capture queue, then emits the tail via `notifyListeners`
    before tearing down the engine.
  - Android: the capture thread emits any residual `chunkBuffer` after the
    loop exits; `stop()` still `join`s the thread, so the event is fired
    before the call resolves.
  - Web: new `flush` / `flushed` handshake between `web.ts` and the
    AudioWorklet. Worklet messages now carry an explicit `{ type: 'chunk' | 'flushed' }`
    discriminator. There is a 250 ms safety timeout so a stuck worklet won't
    block `stopCapture`.

## [0.1.2] — 2026-05-11

### Changed
- Web no longer round-trips chunks through base64. The `AudioWorklet`
  emits a `Float32Array` straight into `notifyListeners`, and the JS
  wrapper passes it through without decoding. Native (iOS/Android) keeps
  shipping base64 over the Capacitor bridge — there the encoding is still
  the cheapest JSON-serializable representation. The consumer-facing
  `listener` signature is unchanged (`(sequence, chunk: Float32Array)`).
- `AudioChunkEvent.data` widened to `string | Float32Array` to reflect the
  asymmetric protocol. Consumers using the low-level
  `addListener('audioChunk', ...)` escape hatch must handle both shapes;
  the high-level `startCapture({ listener })` path normalizes for you.

### Removed
- Internal `float32ToBase64` helper in `src/web.ts` — dead code after the
  change above.

## [0.1.0] — 2026-05-07

### Added
- Audio capture on **web / Android / iOS** via Capacitor v7.
- API: `startCapture(options?)`, `stopCapture()`, `release()`.
- Stream of mono Float32 PCM chunks delivered as `Float32Array` through a
  `listener` callback in `options`. (Bridge transports base64; the JS
  wrapper decodes once into `Float32Array` before invoking the listener.)
- Web: DSP (resample, RMS / silence, buffering) inside a dedicated AudioWorklet.
- Android: `AudioRecord` (`VOICE_RECOGNITION`, 44.1 kHz PCM16), reader thread,
  linear resample, and silence detection.
- iOS: `AVAudioEngine.installTap` at the native format, mono mix-down, linear
  resample, RMS, and a dedicated dispatch queue.
- Permissions: automatic runtime microphone request.
- Build pipeline: AudioWorklet bundled and inlined as a string via
  `scripts/inline-workers.mjs`.

### Design
- No format conversion or compression — the plugin emits raw PCM and the
  consumer decides how to handle it.
