package com.cantoo.plugins.audiocapture;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.util.Base64;

import androidx.core.content.ContextCompat;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

class AudioCapture {

    interface ChunkEmitter {
        void onChunk(int sequence, String base64Data);
    }

    private static final int FALLBACK_SAMPLE_RATE = 44100;
    private static final int CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO;
    private static final int AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT;

    private final AudioCapturePlugin plugin;
    private Thread captureThread;
    private volatile boolean running = false;
    private AudioRecord audioRecord;

    private int chunkDurationMs;
    private int targetSampleRate;
    private int nativeSampleRate;
    private double silenceThreshold;
    private ChunkEmitter emitter;

    AudioCapture(AudioCapturePlugin plugin) {
        this.plugin = plugin;
    }

    boolean hasPermission() {
        return ContextCompat.checkSelfPermission(plugin.getContext(), Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
    }

    synchronized void start(int chunkDurationMs, int targetSampleRate, double silenceThreshold, ChunkEmitter emitter)
            throws IllegalStateException, SecurityException {
        if (running) throw new IllegalStateException("Capture already in progress.");
        if (!hasPermission()) throw new SecurityException("RECORD_AUDIO permission not granted.");

        this.chunkDurationMs = chunkDurationMs;
        this.targetSampleRate = targetSampleRate;
        this.silenceThreshold = silenceThreshold;
        this.emitter = emitter;

        // Try opening AudioRecord directly at the requested rate so the platform
        // does the resample with proper anti-aliasing. Fall back to 44.1 kHz
        // (the guaranteed-supported rate on Android) with the manual linear
        // resampler if the device rejects the requested rate.
        int[] candidates = (targetSampleRate != FALLBACK_SAMPLE_RATE)
                ? new int[] { targetSampleRate, FALLBACK_SAMPLE_RATE }
                : new int[] { FALLBACK_SAMPLE_RATE };

        AudioRecord record = null;
        int chosenRate = 0;
        int chosenBuffer = 0;
        for (int rate : candidates) {
            int minBuffer = AudioRecord.getMinBufferSize(rate, CHANNEL_CONFIG, AUDIO_FORMAT);
            if (minBuffer <= 0) continue;
            int bs = Math.max(minBuffer * 2, rate * 2 / 10);
            AudioRecord candidate = createAudioRecord(rate, bs);
            if (candidate.getState() == AudioRecord.STATE_INITIALIZED) {
                record = candidate;
                chosenRate = rate;
                chosenBuffer = bs;
                break;
            }
            candidate.release();
        }
        if (record == null) throw new IllegalStateException("AudioRecord failed to initialize.");

        audioRecord = record;
        nativeSampleRate = chosenRate;

        running = true;
        audioRecord.startRecording();

        final int loopBufferSize = chosenBuffer;
        captureThread = new Thread(() -> captureLoop(loopBufferSize), "AudioCapture-Reader");
        captureThread.start();
    }

    @SuppressLint("MissingPermission")
    private AudioRecord createAudioRecord(int sampleRate, int bufferSize) {
        return new AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                sampleRate,
                CHANNEL_CONFIG,
                AUDIO_FORMAT,
                bufferSize
        );
    }

    synchronized void stop() {
        running = false;
        Thread t = captureThread;
        captureThread = null;
        if (t != null) {
            try {
                t.join(500);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
        }
        if (audioRecord != null) {
            try {
                if (audioRecord.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) {
                    audioRecord.stop();
                }
            } catch (IllegalStateException ignored) {
            }
            audioRecord.release();
            audioRecord = null;
        }
        emitter = null;
    }

    void release() {
        stop();
    }

    private void captureLoop(int bufferSize) {
        final int readSize = Math.max(1024, bufferSize / 2);
        final short[] readBuffer = new short[readSize];

        final int targetChunkSamples = Math.max(1, (int) Math.round(((double) chunkDurationMs / 1000.0) * targetSampleRate));
        float[] chunkBuffer = new float[0];
        float[] resampleCarry = new float[0];
        final double resampleRatio = (double) nativeSampleRate / (double) targetSampleRate;
        int sequence = 0;

        while (running) {
            int read = audioRecord.read(readBuffer, 0, readSize);
            if (read <= 0) continue;

            float[] floatSamples = new float[read];
            for (int i = 0; i < read; i++) {
                floatSamples[i] = readBuffer[i] / 32768f;
            }

            float[] resampled;
            if (resampleRatio == 1.0) {
                resampled = floatSamples;
            } else {
                float[] combined = concat(resampleCarry, floatSamples);
                int outLen = (int) Math.floor((combined.length - 1) / resampleRatio);
                if (outLen <= 0) {
                    resampleCarry = combined;
                    continue;
                }
                resampled = new float[outLen];
                for (int i = 0; i < outLen; i++) {
                    double pos = i * resampleRatio;
                    int idx = (int) Math.floor(pos);
                    double frac = pos - idx;
                    resampled[i] = (float) (combined[idx] * (1.0 - frac) + combined[idx + 1] * frac);
                }
                int consumed = (int) Math.floor(outLen * resampleRatio);
                resampleCarry = sliceFrom(combined, consumed);
            }

            chunkBuffer = concat(chunkBuffer, resampled);
            while (chunkBuffer.length >= targetChunkSamples) {
                float[] chunk = new float[targetChunkSamples];
                System.arraycopy(chunkBuffer, 0, chunk, 0, targetChunkSamples);
                chunkBuffer = sliceFrom(chunkBuffer, targetChunkSamples);

                int seq = sequence++;
                if (silenceThreshold > 0 && rms(chunk) < silenceThreshold) {
                    continue;
                }
                ChunkEmitter e = this.emitter;
                if (e != null) e.onChunk(seq, encodeBase64(chunk));
            }
        }

        // Flush any residual buffered samples shorter than a full chunk.
        if (chunkBuffer.length > 0) {
            int seq = sequence++;
            boolean drop = silenceThreshold > 0 && rms(chunkBuffer) < silenceThreshold;
            if (!drop) {
                ChunkEmitter e = this.emitter;
                if (e != null) e.onChunk(seq, encodeBase64(chunkBuffer));
            }
        }
    }

    private static float[] concat(float[] a, float[] b) {
        if (a.length == 0) return b;
        if (b.length == 0) return a;
        float[] out = new float[a.length + b.length];
        System.arraycopy(a, 0, out, 0, a.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    private static float[] sliceFrom(float[] src, int from) {
        if (from >= src.length) return new float[0];
        float[] out = new float[src.length - from];
        System.arraycopy(src, from, out, 0, out.length);
        return out;
    }

    private static double rms(float[] chunk) {
        double sum = 0;
        for (float v : chunk) sum += v * v;
        return Math.sqrt(sum / chunk.length);
    }

    private static String encodeBase64(float[] samples) {
        ByteBuffer buf = ByteBuffer.allocate(samples.length * 4).order(ByteOrder.LITTLE_ENDIAN);
        for (float v : samples) buf.putFloat(v);
        byte[] bytes = buf.array();
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? java.util.Base64.getEncoder().encodeToString(bytes)
                : Base64.encodeToString(bytes, Base64.NO_WRAP);
    }
}
