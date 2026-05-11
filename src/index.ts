import type { PluginListenerHandle } from '@capacitor/core';
import { registerPlugin } from '@capacitor/core';

import type {
  AudioCapturePlugin,
  AudioChunkEvent,
  AudioChunkListener,
  NativeAudioCapturePlugin,
  StartCaptureOptions,
} from './definitions';

const NativeAudioCapture = registerPlugin<NativeAudioCapturePlugin>('AudioCapture', {
  web: () => import('./web').then(m => new m.AudioCaptureWeb()),
});

let chunkSubscription: PluginListenerHandle | null = null;
let activeListener: AudioChunkListener | null = null;

function decodeBase64ToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

async function detachListener(): Promise<void> {
  activeListener = null;
  if (chunkSubscription) {
    const sub = chunkSubscription;
    chunkSubscription = null;
    await sub.remove();
  }
}

async function attachListener(listener: AudioChunkListener): Promise<void> {
  await detachListener();
  activeListener = listener;
  chunkSubscription = await NativeAudioCapture.addListener('audioChunk', (event: AudioChunkEvent) => {
    const samples = typeof event.data === 'string' ? decodeBase64ToFloat32(event.data) : event.data;
    activeListener?.(event.sequence, samples);
  });
}

const AudioCapture: AudioCapturePlugin = {
  async startCapture(options?: StartCaptureOptions): Promise<void> {
    if (options?.listener) {
      await attachListener(options.listener);
    } else {
      await detachListener();
    }

    await NativeAudioCapture.startCapture({
      chunkDurationMs: options?.chunkDurationMs,
      targetSampleRate: options?.targetSampleRate,
      silenceThreshold: options?.silenceThreshold,
    });
  },

  async stopCapture(): Promise<void> {
    await NativeAudioCapture.stopCapture();
  },

  async release(): Promise<void> {
    await detachListener();
    await NativeAudioCapture.release();
  },

  addListener(eventName, listenerFunc) {
    return NativeAudioCapture.addListener(eventName, listenerFunc);
  },

  async removeAllListeners(): Promise<void> {
    await detachListener();
    await NativeAudioCapture.removeAllListeners();
  },
};

export * from './definitions';
export { AudioCapture };
