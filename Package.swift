// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CantooCapacitorAudioCapture",
    platforms: [.iOS(.v14)],
    products: [
        .library(
            name: "CantooCapacitorAudioCapture",
            targets: ["AudioCapturePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "7.0.0")
    ],
    targets: [
        .target(
            name: "AudioCapturePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/AudioCapturePlugin"),
        .testTarget(
            name: "AudioCapturePluginTests",
            dependencies: ["AudioCapturePlugin"],
            path: "ios/Tests/AudioCapturePluginTests")
    ]
)
