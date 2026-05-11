import type { PluginListenerHandle } from '@capacitor/core';

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

/** Payload delivered by the bridge for every emitted chunk. */
export interface AudioChunkEvent {
  sequence: number;
  /** Base64-encoded little-endian Float32 PCM mono samples. */
  data: string;
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
