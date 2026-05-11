import type { PluginListenerHandle } from '@capacitor/core';

/**
 * Closed set of error codes used by every platform implementation. Consumers
 * should branch on `.code` rather than parsing messages, since the messages
 * are kept short and stable but are not part of the contract.
 *
 * - `PERMISSION_DENIED` — user denied (or never granted) microphone access.
 * - `MICROPHONE_UNAVAILABLE` — microphone missing, not initializable, or
 *   otherwise unusable at the hardware/OS layer.
 * - `ALREADY_CAPTURING` — `startCapture` was called while a session is active.
 * - `UNAVAILABLE` — the platform lacks a required capability (web only:
 *   `getUserMedia` or `AudioWorklet`).
 * - `INTERNAL_ERROR` — fallback for anything that does not map cleanly to
 *   the categories above.
 */
export type AudioCaptureErrorCode =
  | 'PERMISSION_DENIED'
  | 'MICROPHONE_UNAVAILABLE'
  | 'ALREADY_CAPTURING'
  | 'UNAVAILABLE'
  | 'INTERNAL_ERROR';

/**
 * Shape of every error rejected by the plugin. The `.code` is guaranteed to
 * be one of the values in `AudioCaptureErrorCode`.
 */
export interface AudioCaptureError extends Error {
  code: AudioCaptureErrorCode;
}

/**
 * A captured PCM chunk: mono Float32 samples at the negotiated
 * `targetSampleRate`. The wrapper decodes from the bridge's base64
 * representation; the consumer receives `Float32Array` directly.
 *
 * The plugin does no format conversion or compression — your app handles
 * any encoding (WAV/MP3/etc.) or further processing.
 */
export type AudioChunkListener = (sequence: number, chunk: Float32Array) => void;

export interface StartCaptureOptions {
  /** Duration (ms) of each emitted chunk. */
  chunkDurationMs: number;
  /** Target sample rate (Hz). Audio is resampled to this rate before emission. */
  targetSampleRate: number;
  /** RMS amplitude (0..1) below which a chunk is treated as silence and not emitted. */
  silenceThreshold: number;
  /** Stream consumer. Without it, capture runs but emits nothing to user code. */
  listener?: AudioChunkListener;
}

/**
 * Payload delivered by the platform for every emitted chunk.
 *
 * - Native (iOS/Android) ships `data` as base64-encoded little-endian
 *   Float32 PCM mono (the Capacitor bridge only carries JSON-serializable
 *   values).
 * - Web ships `data` as the `Float32Array` directly — there is no bridge
 *   serialization, so base64 would just be a pointless round-trip.
 *
 * The JS wrapper normalizes both into a `Float32Array` before invoking the
 * user's `listener`. Consumers using `addListener('audioChunk', ...)`
 * directly must handle both shapes.
 */
export interface AudioChunkEvent {
  sequence: number;
  data: string | Float32Array;
}

/**
 * Public plugin interface. The wrapper in `index.ts` only adapts the
 * `listener` plumbing — every chunk flows straight from native to the
 * consumer's callback without conversion.
 */
export interface AudioCapturePlugin {
  /**
   * Start capturing audio. If a `listener` is provided in `options`, it
   * receives PCM `Float32Array` chunks as they are produced.
   */
  startCapture(options?: StartCaptureOptions): Promise<void>;

  /** Stop the current capture session and clear capture state. */
  stopCapture(): Promise<void>;

  /** Release native resources and remove all listeners. */
  release(): Promise<void>;

  /**
   * Low-level event subscription. Most consumers should pass `listener` to
   * `startCapture` instead of using this directly.
   */
  addListener(eventName: 'audioChunk', listenerFunc: (event: AudioChunkEvent) => void): Promise<PluginListenerHandle>;

  removeAllListeners(): Promise<void>;
}

/** Bridge-level options for the native plugin. */
export interface NativeStartCaptureOptions {
  chunkDurationMs?: number;
  targetSampleRate?: number;
  silenceThreshold?: number;
}

export interface NativeAudioCapturePlugin {
  startCapture(options?: NativeStartCaptureOptions): Promise<void>;
  stopCapture(): Promise<void>;
  release(): Promise<void>;
  addListener(eventName: 'audioChunk', listenerFunc: (event: AudioChunkEvent) => void): Promise<PluginListenerHandle>;
  removeAllListeners(): Promise<void>;
}
