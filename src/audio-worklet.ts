declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(
  name: string,
  processorCtor: new (options?: { processorOptions?: ProcessorOptions }) => AudioWorkletProcessor,
): void;

interface ProcessorOptions {
  targetSampleRate: number;
  chunkSamples: number;
  silenceThreshold: number;
}

class CantooAudioCaptureProcessor extends AudioWorkletProcessor {
  private targetSampleRate: number;
  private chunkSamples: number;
  private silenceThreshold: number;
  private resampleRatio: number;
  private resampleCarry: Float32Array = new Float32Array(0);
  private chunkBuffer: Float32Array = new Float32Array(0);
  private sequence = 0;

  constructor(options: { processorOptions?: ProcessorOptions } = {}) {
    super();
    const opts = options.processorOptions;
    if (!opts) throw new Error('processorOptions are required');
    this.targetSampleRate = opts.targetSampleRate;
    this.chunkSamples = opts.chunkSamples;
    this.silenceThreshold = opts.silenceThreshold;
    this.resampleRatio = sampleRate / this.targetSampleRate;
  }

  private resample(samples: Float32Array): Float32Array {
    if (this.resampleRatio === 1) return samples;
    const combined = new Float32Array(this.resampleCarry.length + samples.length);
    combined.set(this.resampleCarry);
    combined.set(samples, this.resampleCarry.length);
    const outLen = Math.floor((combined.length - 1) / this.resampleRatio);
    if (outLen <= 0) {
      this.resampleCarry = combined;
      return new Float32Array(0);
    }
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * this.resampleRatio;
      const idx = Math.floor(pos);
      const frac = pos - idx;
      out[i] = combined[idx] * (1 - frac) + combined[idx + 1] * frac;
    }
    const consumed = Math.floor(outLen * this.resampleRatio);
    this.resampleCarry = combined.slice(consumed);
    return out;
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;

    const resampled = this.resample(channel);
    if (resampled.length > 0) {
      const merged = new Float32Array(this.chunkBuffer.length + resampled.length);
      merged.set(this.chunkBuffer);
      merged.set(resampled, this.chunkBuffer.length);
      this.chunkBuffer = merged;
    }

    while (this.chunkBuffer.length >= this.chunkSamples) {
      const chunk = this.chunkBuffer.slice(0, this.chunkSamples);
      this.chunkBuffer = this.chunkBuffer.slice(this.chunkSamples);

      let silent = false;
      if (this.silenceThreshold > 0) {
        let sumSq = 0;
        for (const v of chunk) sumSq += v * v;
        const rms = Math.sqrt(sumSq / chunk.length);
        silent = rms < this.silenceThreshold;
      }

      const seq = this.sequence++;
      const buffer = chunk.buffer;
      this.port.postMessage({ sequence: seq, buffer, silent }, [buffer]);
    }

    return true;
  }
}

registerProcessor('cantoo-audio-capture-processor', CantooAudioCaptureProcessor);

export {};
