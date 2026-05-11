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
            call.reject("Microphone permission denied.", "PERMISSION_DENIED");
            pendingArgs = null;
            return;
        }
        PendingArgs args = pendingArgs;
        pendingArgs = null;
        if (args == null) {
            call.reject("Internal state error.", "INTERNAL_ERROR");
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
            rejectMapped(call, e);
        }
    }

    @PluginMethod
    public void stopCapture(PluginCall call) {
        try {
            capture.stop();
            call.resolve();
        } catch (Exception e) {
            rejectMapped(call, e);
        }
    }

    @PluginMethod
    public void release(PluginCall call) {
        try {
            capture.release();
            call.resolve();
        } catch (Exception e) {
            rejectMapped(call, e);
        }
    }

    private static void rejectMapped(PluginCall call, Throwable t) {
        String code = mapErrorCode(t);
        String message = t.getMessage();
        if (message == null) message = defaultMessage(code);
        call.reject(message, code, t instanceof Exception ? (Exception) t : new Exception(t));
    }

    private static String mapErrorCode(Throwable t) {
        if (t instanceof SecurityException) return "PERMISSION_DENIED";
        if (t instanceof IllegalStateException) {
            String msg = t.getMessage();
            if (msg != null) {
                if (msg.contains("Capture already in progress")) return "ALREADY_CAPTURING";
                if (msg.contains("buffer size") || msg.contains("AudioRecord failed to initialize")) {
                    return "MICROPHONE_UNAVAILABLE";
                }
            }
        }
        return "INTERNAL_ERROR";
    }

    private static String defaultMessage(String code) {
        switch (code) {
            case "PERMISSION_DENIED": return "Microphone permission denied.";
            case "MICROPHONE_UNAVAILABLE": return "Microphone unavailable.";
            case "ALREADY_CAPTURING": return "Capture already in progress.";
            default: return "Unknown error.";
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
