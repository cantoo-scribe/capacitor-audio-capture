import type { PluginListenerHandle } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';

import type {
  AudioCapturePlugin,
  AudioChunkEvent,
  AudioChunkListener,
  NativeAudioCapturePlugin,
  StartCaptureOptions,
  StopCaptureResult,
} from './definitions';

const NativeAudioCapture = registerPlugin<NativeAudioCapturePlugin>('AudioCapture', {
  web: () => import('./web').then(m => new m.AudioCaptureWeb()),
});

let chunkSubscription: PluginListenerHandle | null = null;
let activeListener: AudioChunkListener | null = null;
// `null` means accumulation is disabled; an array (possibly empty) means it's on.
let accumulatedChunks: Float32Array[] | null = null;

function decodeBase64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function concatFloat32(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function detachSubscription(): Promise<void> {
  activeListener = null;
  accumulatedChunks = null;
  if (chunkSubscription) {
    const sub = chunkSubscription;
    chunkSubscription = null;
    await sub.remove();
  }
}

async function attachSubscription(listener: AudioChunkListener | null, accumulate: boolean): Promise<void> {
  await detachSubscription();
  activeListener = listener;
  accumulatedChunks = accumulate ? [] : null;
  if (!listener && !accumulate) return;
  chunkSubscription = await NativeAudioCapture.addListener('audioChunk', (event: AudioChunkEvent) => {
    const samples = typeof event.data === 'string' ? decodeBase64ToFloat32(event.data) : event.data;
    accumulatedChunks?.push(samples);
    activeListener?.(event.sequence, samples);
  });
}

const AudioCapture: AudioCapturePlugin = {
  async startCapture(options?: StartCaptureOptions): Promise<void> {
    await attachSubscription(options?.listener ?? null, options?.accumulate === true);

    await NativeAudioCapture.startCapture({
      chunkDurationMs: options?.chunkDurationMs,
      targetSampleRate: options?.targetSampleRate,
      silenceThreshold: options?.silenceThreshold,
    });
  },

  async stopCapture(): Promise<StopCaptureResult> {
    await NativeAudioCapture.stopCapture();
    const chunks = accumulatedChunks;
    accumulatedChunks = null;
    return { audio: chunks ? concatFloat32(chunks) : new Float32Array(0) };
  },

  async release(): Promise<void> {
    await detachSubscription();
    await NativeAudioCapture.release();
  },

  addListener(eventName, listenerFunc) {
    return NativeAudioCapture.addListener(eventName, listenerFunc);
  },

  async removeAllListeners(): Promise<void> {
    await detachSubscription();
    await NativeAudioCapture.removeAllListeners();
  },
};

export * from './definitions';
export { AudioCapture };
