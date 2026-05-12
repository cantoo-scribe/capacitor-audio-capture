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
    private var chunkTargetSamples: Int = 0
    private var nativeSampleRate: Double = 0
    private var converter: AVAudioConverter?
    private var targetFormat: AVAudioFormat?

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
        self.chunkTargetSamples = max(1, Int((Double(chunkDurationMs) / 1000.0) * targetSampleRate))

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        nativeSampleRate = inputFormat.sampleRate

        // Set up an AVAudioConverter to handle both sample-rate conversion
        // (with proper anti-aliasing) and channel downmix to mono in one step.
        self.targetFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                         sampleRate: targetSampleRate,
                                         channels: 1,
                                         interleaved: false)
        if let target = self.targetFormat {
            self.converter = AVAudioConverter(from: inputFormat, to: target)
        }

        input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { [weak self] buffer, _ in
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
        converter = nil
        targetFormat = nil
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
        if buffer.frameLength == 0 { return }

        let converted = convert(buffer: buffer)
        if converted.isEmpty { return }

        chunkBuffer.append(contentsOf: converted)
        while chunkBuffer.count >= chunkTargetSamples {
            let chunk = Array(chunkBuffer[0..<chunkTargetSamples])
            chunkBuffer.removeFirst(chunkTargetSamples)
            emit(chunk: chunk)
        }
    }

    private func convert(buffer: AVAudioPCMBuffer) -> [Float] {
        guard let converter = converter, let targetFormat = targetFormat else {
            return []
        }

        // Output capacity: input frames scaled by the rate ratio, plus a margin
        // for the converter's internal filter group delay.
        let ratio = targetSampleRate / max(nativeSampleRate, 1)
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1024
        guard let outBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else {
            return []
        }

        var provided = false
        var error: NSError?
        let status = converter.convert(to: outBuffer, error: &error) { _, statusPtr in
            if provided {
                statusPtr.pointee = .noDataNow
                return nil
            }
            provided = true
            statusPtr.pointee = .haveData
            return buffer
        }

        if status == .error || error != nil { return [] }

        let frames = Int(outBuffer.frameLength)
        if frames == 0 { return [] }
        guard let ptr = outBuffer.floatChannelData?[0] else { return [] }
        return Array(UnsafeBufferPointer(start: ptr, count: frames))
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
