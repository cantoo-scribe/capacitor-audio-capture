import { WebPlugin } from '@capacitor/core';

import type { NativeAudioCapturePlugin, NativeStartCaptureOptions } from './definitions';

const DEFAULT_CHUNK_MS = 1000;
const DEFAULT_TARGET_SR = 16000;
const DEFAULT_SILENCE = 0;
const PROCESSOR_NAME = 'cantoo-audio-capture-processor';

// Replaced at build time with the bundled audio worklet source (IIFE).
const WORKLET_SOURCE = '__AUDIO_WORKLET_SOURCE_PLACEHOLDER__';

interface WorkletMessage {
  sequence: number;
  buffer: ArrayBuffer;
  silent: boolean;
}

export class AudioCaptureWeb extends WebPlugin implements NativeAudioCapturePlugin {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private workletUrl: string | null = null;

  async startCapture(options?: NativeStartCaptureOptions): Promise<void> {
    if (this.workletNode) {
      throw new Error('Capture already in progress.');
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw this.unavailable('getUserMedia is not available in this environment.');
    }

    const chunkDurationMs = options?.chunkDurationMs ?? DEFAULT_CHUNK_MS;
    const targetSampleRate = options?.targetSampleRate ?? DEFAULT_TARGET_SR;
    const silenceThreshold = options?.silenceThreshold ?? DEFAULT_SILENCE;
    const chunkSamples = Math.max(1, Math.round((chunkDurationMs / 1000) * targetSampleRate));

    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const Ctx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioContext = new Ctx();

    if (!this.audioContext.audioWorklet) {
      await this.cleanupNodes();
      throw this.unavailable('AudioWorklet is not available in this environment.');
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
  }

  async stopCapture(): Promise<void> {
    await this.cleanupNodes();
  }

  async release(): Promise<void> {
    await this.stopCapture();
    await this.removeAllListeners();
  }

  private onWorkletMessage = (event: MessageEvent<WorkletMessage>): void => {
    const { sequence, buffer, silent } = event.data;
    if (silent) return;
    const samples = new Float32Array(buffer);
    this.notifyListeners('audioChunk', { sequence, data: float32ToBase64(samples) });
  };

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

function float32ToBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  const blockSize = 0x8000;
  for (let i = 0; i < bytes.length; i += blockSize) {
    const slice = bytes.subarray(i, Math.min(i + blockSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}
