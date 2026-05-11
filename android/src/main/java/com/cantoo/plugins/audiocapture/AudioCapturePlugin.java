package com.cantoo.plugins.audiocapture;

import android.Manifest;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "AudioCapture",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class AudioCapturePlugin extends Plugin {

    private AudioCapture capture;

    @Override
    public void load() {
        capture = new AudioCapture(this);
    }

    @PluginMethod
    public void startCapture(PluginCall call) {
        int chunkDurationMs = call.getInt("chunkDurationMs", 1000);
        int targetSampleRate = call.getInt("targetSampleRate", 16000);
        double silenceThreshold = call.getDouble("silenceThreshold", 0.0);

        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.setKeepAlive(true);
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            pendingArgs = new PendingArgs(chunkDurationMs, targetSampleRate, silenceThreshold);
            return;
        }

        doStart(call, chunkDurationMs, targetSampleRate, silenceThreshold);
    }

    private PendingArgs pendingArgs;

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone permission denied.");
            pendingArgs = null;
            return;
        }
        PendingArgs args = pendingArgs;
        pendingArgs = null;
        if (args == null) {
            call.reject("Internal state error.");
            return;
        }
        doStart(call, args.chunkDurationMs, args.targetSampleRate, args.silenceThreshold);
    }

    private void doStart(PluginCall call, int chunkDurationMs, int targetSampleRate, double silenceThreshold) {
        try {
            capture.start(chunkDurationMs, targetSampleRate, silenceThreshold, (sequence, base64Data) -> {
                JSObject event = new JSObject();
                event.put("sequence", sequence);
                event.put("data", base64Data);
                notifyListeners("audioChunk", event);
            });
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stopCapture(PluginCall call) {
        try {
            capture.stop();
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    @PluginMethod
    public void release(PluginCall call) {
        try {
            capture.release();
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (capture != null) capture.release();
        super.handleOnDestroy();
    }

    private static final class PendingArgs {
        final int chunkDurationMs;
        final int targetSampleRate;
        final double silenceThreshold;

        PendingArgs(int chunkDurationMs, int targetSampleRate, double silenceThreshold) {
            this.chunkDurationMs = chunkDurationMs;
            this.targetSampleRate = targetSampleRate;
            this.silenceThreshold = silenceThreshold;
        }
    }
}
