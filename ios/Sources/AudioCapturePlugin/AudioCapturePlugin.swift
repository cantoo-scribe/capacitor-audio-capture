import AVFoundation
import Capacitor
import Foundation

@objc(AudioCapturePlugin)
public class AudioCapturePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AudioCapturePlugin"
    public let jsName = "AudioCapture"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopCapture", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "release", returnType: CAPPluginReturnPromise)
    ]

    private let capture = AudioCapture()

    @objc func startCapture(_ call: CAPPluginCall) {
        let chunkDurationMs = call.getInt("chunkDurationMs") ?? 1000
        let targetSampleRate = call.getDouble("targetSampleRate") ?? 16000
        let silenceThreshold = Float(call.getDouble("silenceThreshold") ?? 0)

        let proceed: () -> Void = { [weak self] in
            guard let self = self else { return }
            do {
                try self.capture.start(
                    chunkDurationMs: chunkDurationMs,
                    targetSampleRate: targetSampleRate,
                    silenceThreshold: silenceThreshold
                ) { [weak self] sequence, base64 in
                    self?.notifyListeners("audioChunk", data: [
                        "sequence": sequence,
                        "data": base64
                    ])
                }
                call.resolve()
            } catch {
                let (message, code) = AudioCapturePlugin.mapErrorCode(error)
                call.reject(message, code)
            }
        }

        if capture.hasPermission() {
            proceed()
        } else {
            capture.requestPermission { granted in
                if granted {
                    proceed()
                } else {
                    call.reject("Microphone permission denied.", "PERMISSION_DENIED")
                }
            }
        }
    }

    private static func mapErrorCode(_ error: Error) -> (String, String) {
        if case AudioCaptureNativeError.alreadyCapturing = error {
            return ("Capture already in progress.", "ALREADY_CAPTURING")
        }
        if error is AVError {
            return ("Microphone unavailable.", "MICROPHONE_UNAVAILABLE")
        }
        let nsError = error as NSError
        if nsError.domain == NSOSStatusErrorDomain || nsError.domain.contains("AVFoundation") {
            return ("Microphone unavailable.", "MICROPHONE_UNAVAILABLE")
        }
        return (error.localizedDescription, "INTERNAL_ERROR")
    }

    @objc func stopCapture(_ call: CAPPluginCall) {
        capture.stop()
        call.resolve()
    }

    @objc func release(_ call: CAPPluginCall) {
        capture.release()
        call.resolve()
    }
}
