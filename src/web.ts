import { WebPlugin } from '@capacitor/core';

import type {
  AudioCaptureError,
  AudioCaptureErrorCode,
  NativeAudioCapturePlugin,
  NativeStartCaptureOptions,
} from './definitions';

const DEFAULT_CHUNK_MS = 1000;
const DEFAULT_TARGET_SR = 16000;
const DEFAULT_SILENCE = 0;
const PROCESSOR_NAME = 'cantoo-audio-capture-processor';

// Replaced at build time with the bundled audio worklet source (IIFE).
const WORKLET_SOURCE = '__AUDIO_WORKLET_SOURCE_PLACEHOLDER__';

type WorkletMessage = { type: 'chunk'; sequence: number; buffer: ArrayBuffer; silent: boolean } | { type: 'flushed' };

const FLUSH_TIMEOUT_MS = 250;

function captureError(message: string, code: AudioCaptureErrorCode): AudioCaptureError {
  const err = new Error(message) as AudioCaptureError;
  err.code = code;
  return err;
}

export class AudioCaptureWeb extends WebPlugin implements NativeAudioCapturePlugin {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private workletUrl: string | null = null;

  async startCapture(options?: NativeStartCaptureOptions): Promise<void> {
    if (this.workletNode) {
      throw captureError('Capture already in progress.', 'ALREADY_CAPTURING');
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw captureError('getUserMedia is not available in this environment.', 'UNAVAILABLE');
    }

    const chunkDurationMs = options?.chunkDurationMs ?? DEFAULT_CHUNK_MS;
    const targetSampleRate = options?.targetSampleRate ?? DEFAULT_TARGET_SR;
    const silenceThreshold = options?.silenceThreshold ?? DEFAULT_SILENCE;
    const chunkSamples = Math.max(1, Math.round((chunkDurationMs / 1000) * targetSampleRate));

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      await this.cleanupNodes();
      const name = (e as DOMException)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw captureError('Microphone permission denied.', 'PERMISSION_DENIED');
      }
      if (
        name === 'NotFoundError' ||
        name === 'OverconstrainedError' ||
        name === 'NotReadableError' ||
        name === 'AbortError'
      ) {
        throw captureError('Microphone unavailable.', 'MICROPHONE_UNAVAILABLE');
      }
      throw captureError((e as Error)?.message ?? 'Unknown getUserMedia failure', 'INTERNAL_ERROR');
    }

    try {
      const Ctx =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new Ctx();

      if (!this.audioContext.audioWorklet) {
        await this.cleanupNodes();
        throw captureError('AudioWorklet is not available in this environment.', 'UNAVAILABLE');
      }

      this.workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
      await this.audioContext.audioWorklet.addModule(this.workletUrl);

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.workletNode = new AudioWorkletNode(this.audioContext, PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: {
          targetSampleRate,
          chunkSamples,
          silenceThreshold,
        },
      });

      this.workletNode.port.onmessage = this.onWorkletMessage;

      this.sourceNode.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);
    } catch (e) {
      await this.cleanupNodes();
      if ((e as AudioCaptureError)?.code) throw e;
      throw captureError((e as Error)?.message ?? 'Unknown error', 'INTERNAL_ERROR');
    }
  }

  async stopCapture(): Promise<void> {
    await this.flushWorklet();
    await this.cleanupNodes();
  }

  async release(): Promise<void> {
    await this.stopCapture();
    await this.removeAllListeners();
  }

  private onWorkletMessage = (event: MessageEvent<WorkletMessage>): void => {
    const msg = event.data;
    if (msg.type !== 'chunk' || msg.silent) return;
    // Web has no bridge serialization, so we emit the Float32Array directly —
    // the wrapper in index.ts handles both this and the base64 path used by
    // the native platforms.
    this.notifyListeners('audioChunk', { sequence: msg.sequence, data: new Float32Array(msg.buffer) });
  };

  private flushWorklet(): Promise<void> {
    return new Promise(resolve => {
      const node = this.workletNode;
      if (!node) {
        resolve();
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        node.port.removeEventListener('message', onMessage);
        clearTimeout(timer);
        resolve();
      };
      const onMessage = (event: MessageEvent<WorkletMessage>): void => {
        if (event.data?.type === 'flushed') finish();
      };
      node.port.addEventListener('message', onMessage);
      const timer = setTimeout(finish, FLUSH_TIMEOUT_MS);
      node.port.postMessage({ type: 'flush' });
    });
  }

  private async cleanupNodes(): Promise<void> {
    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.port.close();
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    this.sourceNode?.disconnect();
    this.sourceNode = null;

    this.mediaStream?.getTracks().forEach(t => {
      t.stop();
    });
    this.mediaStream = null;

    if (this.audioContext) {
      await this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }

    if (this.workletUrl) {
      URL.revokeObjectURL(this.workletUrl);
      this.workletUrl = null;
    }
  }
}
