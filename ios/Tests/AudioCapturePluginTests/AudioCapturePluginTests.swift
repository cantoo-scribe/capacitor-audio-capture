import XCTest

@testable import AudioCapturePlugin

final class AudioCapturePluginTests: XCTestCase {
    func testPluginInstantiation() throws {
        _ = AudioCapturePlugin()
    }
}
