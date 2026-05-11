# @cantoo/capacitor-audio-capture

> Capacitor v7 plugin that captures microphone audio on **web / Android / iOS**
> and streams **raw PCM** as `Float32Array` (mono) chunks to the consumer.
> No format conversion, no compression — your app decides what to do with
> the samples.

[![npm](https://img.shields.io/npm/v/@cantoo/capacitor-audio-capture.svg)](https://www.npmjs.com/package/@cantoo/capacitor-audio-capture)
[![license](https://img.shields.io/npm/l/@cantoo/capacitor-audio-capture.svg)](./LICENSE)

---

## Platforms

| Platform | Implementation                                                       | Minimum            |
| -------- | -------------------------------------------------------------------- | ------------------ |
| Web      | `getUserMedia` + `AudioWorklet` (DSP off the main thread)            | modern browser     |
| Android  | `AudioRecord` (44.1 kHz PCM16) on a dedicated thread                 | API 23 (Android 6) |
| iOS      | `AVAudioEngine.installTap` on a dedicated queue                      | iOS 14             |

Native captures mono audio, resamples it to `targetSampleRate` via linear
interpolation, applies optional RMS silence filtering, and ships each chunk
over the bridge as base64 little-endian Float32 PCM. The JS wrapper decodes
that base64 once and hands the consumer a `Float32Array` — no further
encoding/decoding inside the plugin.

## Installation

```bash
pnpm add @cantoo/capacitor-audio-capture
# or: npm i @cantoo/capacitor-audio-capture
# or: yarn add @cantoo/capacitor-audio-capture

npx cap sync
```

### Permissions

- **iOS** — add to `Info.plist`:
  ```xml
  <key>NSMicrophoneUsageDescription</key>
  <string>Used to record audio while you use the app.</string>
  ```
- **Android** — `RECORD_AUDIO` is already declared by the plugin; permission is
  requested at runtime on the first call to `startCapture`.
- **Web** — requires a secure context (HTTPS or `localhost`) and the user must
  grant microphone access.

## Usage

```ts
import { AudioCapture } from '@cantoo/capacitor-audio-capture';

await AudioCapture.startCapture({
  chunkDurationMs: 250,
  targetSampleRate: 16000,
  silenceThreshold: 0.01,
  listener: (sequence, chunk) => {
    // chunk: Float32Array, mono, at targetSampleRate (samples in -1..1)
    console.log(sequence, chunk.length);
  },
});

// later
await AudioCapture.stopCapture();
await AudioCapture.release();
```

### Examples

**Send to a backend** (base64-encode just before the request):

```ts
listener: (_seq, chunk) => {
  const bytes = new Uint8Array(chunk.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const base64 = btoa(bin);
  fetch('/api/audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: chunk.buffer,
  });
}
```

**Buffer for a client-side WAV**:

```ts
await AudioCapture.startCapture({
  chunkDurationMs: 250,
  targetSampleRate: 16000,
  silenceThreshold: 0,
  accumulate: true,
});
// ... user stops ...
const { audio } = await AudioCapture.stopCapture();
// `audio` is a Float32Array of the full session — convert to Int16,
// prepend a 44-byte WAV header, and you have a playable file.
```

## API

### `startCapture(options?)`

| Field              | Type                                                  | Default | Description                                                  |
| ------------------ | ----------------------------------------------------- | ------- | ------------------------------------------------------------ |
| `chunkDurationMs`  | `number`                                              | `1000`  | Duration of each emitted chunk.                              |
| `targetSampleRate` | `number`                                              | `16000` | Target sample rate. Audio is resampled to this value.        |
| `silenceThreshold` | `number` (RMS 0..1)                                   | `0`     | Chunks with RMS below this value are dropped (`0` disables). |
| `listener`         | `(sequence: number, chunk: Float32Array) => void`     | —       | Stream consumer. Without it, capture runs but emits nothing. |
| `accumulate`       | `boolean`                                             | `false` | Buffer every emitted chunk and return the concatenated PCM from `stopCapture`. Silent chunks are skipped. |

`sequence` is monotonically increasing per session and resets on every
`startCapture`. It is incremented even for chunks dropped by silence
detection, so consumers can detect temporal gaps.

### `stopCapture()`

Stops capture and releases the active capture session. Returns
`{ audio: Float32Array }`. When the session was started with `accumulate: true`,
`audio` is the concatenated PCM (mono Float32 at `targetSampleRate`); otherwise
it is an empty `Float32Array`.

### `release()`

Stops capture, removes listeners, and frees every open resource.

### Exported types

```ts
import type {
  AudioCapturePlugin,
  AudioChunkListener,  // (sequence, chunk: Float32Array) => void
  AudioCaptureError,
  AudioCaptureErrorCode,
  StartCaptureOptions,
} from '@cantoo/capacitor-audio-capture';
```

## Error handling

Every rejected Promise from the plugin carries a `.code` from a closed set,
identical across iOS, Android, and Web. Branch on `.code` rather than parsing
messages — the messages are short and stable, but only the code is part of the
public contract.

| Code                     | When it's raised                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `PERMISSION_DENIED`      | User denied microphone access (or never granted it).                                          |
| `MICROPHONE_UNAVAILABLE` | Microphone missing, busy, or fails to initialize (no input device, hardware/OS-level issue). |
| `ALREADY_CAPTURING`      | `startCapture` was called while a session is already running.                                 |
| `UNAVAILABLE`            | Web only: `getUserMedia` or `AudioWorklet` is missing in this environment.                    |
| `INTERNAL_ERROR`         | Fallback for anything not matching the categories above.                                      |

```ts
import { AudioCapture, type AudioCaptureError } from '@cantoo/capacitor-audio-capture';

try {
  await AudioCapture.startCapture({ /* ... */ });
} catch (e) {
  const code = (e as AudioCaptureError).code;
  if (code === 'PERMISSION_DENIED') {
    // prompt user to enable mic access in OS settings
  } else if (code === 'MICROPHONE_UNAVAILABLE') {
    // surface a "no microphone" state in UI
  } else if (code === 'ALREADY_CAPTURING') {
    // ignore or call stopCapture() first
  }
}
```

## Why base64 on the wire, `Float32Array` in the API?

Capacitor's native↔JS bridge can only carry JSON-serializable values.
Encoding the PCM samples as base64 is ~33% smaller than a JSON number array
and significantly faster to serialize/deserialize on both sides. The
plugin's wrapper does the **one** decode (base64 → `Float32Array`) so the
consumer always receives the natural representation for audio: a typed
array of mono samples in `[-1, 1]`.

## Web and Content-Security-Policy

On web, the `AudioWorkletProcessor` is inlined as a string and loaded via
`URL.createObjectURL(new Blob([...]))`. If the host app has a strict CSP
that doesn't allow `blob:` in `script-src` / `worker-src`, the worklet
won't load — simply allow `blob:` in the appropriate directive.

## License

[MIT](./LICENSE) © Cantoo
