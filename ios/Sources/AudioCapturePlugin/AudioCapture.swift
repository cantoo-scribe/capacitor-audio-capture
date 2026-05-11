import AVFoundation
import Foundation

enum AudioCaptureNativeError: Error {
    case alreadyCapturing
}

final class AudioCapture {
    typealias ChunkEmitter = (_ sequence: Int, _ base64Data: String) -> Void

    private let engine = AVAudioEngine()
    private var isRunning = false

    private var chunkDurationMs: Int = 1000
    private var targetSampleRate: Double = 16000
    private var silenceThreshold: Float = 0
    private var emitter: ChunkEmitter?

    private var sequence: Int = 0
    private var chunkBuffer: [Float] = []
    private var resampleCarry: [Float] = []
    private var chunkTargetSamples: Int = 0
    private var nativeSampleRate: Double = 0

    private let workQueue = DispatchQueue(label: "com.cantoo.audiocapture.work")

    func hasPermission() -> Bool {
        if #available(iOS 17.0, *) {
            return AVAudioApplication.shared.recordPermission == .granted
        } else {
            return AVAudioSession.sharedInstance().recordPermission == .granted
        }
    }

    func requestPermission(completion: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission { granted in
                DispatchQueue.main.async { completion(granted) }
            }
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                DispatchQueue.main.async { completion(granted) }
            }
        }
    }

    func start(chunkDurationMs: Int,
               targetSampleRate: Double,
               silenceThreshold: Float,
               emitter: @escaping ChunkEmitter) throws {
        if isRunning { throw AudioCaptureNativeError.alreadyCapturing }

        self.chunkDurationMs = chunkDurationMs
        self.targetSampleRate = targetSampleRate
        self.silenceThreshold = silenceThreshold
        self.emitter = emitter
        self.sequence = 0
        self.chunkBuffer = []
        self.resampleCarry = []
        self.chunkTargetSamples = max(1, Int((Double(chunkDurationMs) / 1000.0) * targetSampleRate))

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        nativeSampleRate = format.sampleRate

        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            self?.workQueue.async {
                self?.process(buffer: buffer)
            }
        }

        engine.prepare()
        try engine.start()
        isRunning = true
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        // Drain any in-flight buffer processing before flushing the tail.
        workQueue.sync { }
        flushTail()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        emitter = nil
        chunkBuffer = []
        resampleCarry = []
    }

    private func flushTail() {
        guard !chunkBuffer.isEmpty, let emit = emitter else { return }
        let seq = sequence
        sequence += 1
        if silenceThreshold > 0 {
            var sumSq: Float = 0
            for v in chunkBuffer { sumSq += v * v }
            let rms = sqrt(sumSq / Float(chunkBuffer.count))
            if rms < silenceThreshold { return }
        }
        let data = chunkBuffer.withUnsafeBufferPointer { ptr -> Data in
            Data(buffer: ptr)
        }
        emit(seq, data.base64EncodedString())
    }

    func release() {
        stop()
    }

    private func process(buffer: AVAudioPCMBuffer) {
        guard let channelData = buffer.floatChannelData else { return }
        let frameCount = Int(buffer.frameLength)
        if frameCount == 0 { return }

        var samples = [Float](repeating: 0, count: frameCount)
        let channels = Int(buffer.format.channelCount)
        if channels == 1 {
            samples.withUnsafeMutableBufferPointer { ptr in
                ptr.baseAddress!.update(from: channelData[0], count: frameCount)
            }
        } else {
            // Mix down to mono (simple average across channels).
            for i in 0..<frameCount {
                var sum: Float = 0
                for c in 0..<channels { sum += channelData[c][i] }
                samples[i] = sum / Float(channels)
            }
        }

        let resampled = resample(samples)
        if resampled.isEmpty { return }

        chunkBuffer.append(contentsOf: resampled)
        while chunkBuffer.count >= chunkTargetSamples {
            let chunk = Array(chunkBuffer[0..<chunkTargetSamples])
            chunkBuffer.removeFirst(chunkTargetSamples)
            emit(chunk: chunk)
        }
    }

    private func resample(_ samples: [Float]) -> [Float] {
        let ratio = nativeSampleRate / targetSampleRate
        if abs(ratio - 1.0) < 1e-9 { return samples }

        var combined = resampleCarry
        combined.append(contentsOf: samples)

        let outLen = Int(floor(Double(combined.count - 1) / ratio))
        if outLen <= 0 {
            resampleCarry = combined
            return []
        }

        var out = [Float](repeating: 0, count: outLen)
        for i in 0..<outLen {
            let pos = Double(i) * ratio
            let idx = Int(floor(pos))
            let frac = Float(pos - Double(idx))
            out[i] = combined[idx] * (1 - frac) + combined[idx + 1] * frac
        }

        let consumed = Int(floor(Double(outLen) * ratio))
        resampleCarry = Array(combined[consumed..<combined.count])
        return out
    }

    private func emit(chunk: [Float]) {
        let seq = sequence
        sequence += 1

        if silenceThreshold > 0 {
            var sumSq: Float = 0
            for v in chunk { sumSq += v * v }
            let rms = sqrt(sumSq / Float(chunk.count))
            if rms < silenceThreshold { return }
        }

        let data = chunk.withUnsafeBufferPointer { ptr -> Data in
            Data(buffer: ptr)
        }
        let base64 = data.base64EncodedString()
        emitter?(seq, base64)
    }
}
