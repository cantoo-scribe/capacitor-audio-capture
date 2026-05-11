# Changelog

All notable changes to this package are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/);
versioning follows [SemVer](https://semver.org/).

## [Unreleased]

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
