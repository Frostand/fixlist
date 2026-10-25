// swift-tools-version: 6.0
import PackageDescription
import Foundation
// The regeneration driver supplies a verified, patched SDK outside the checkout.
let sdk = ProcessInfo.processInfo.environment["FIXLIST_VOICE_SDK_PATH"]!
let package = Package(name: "FixListVoicePackHost", platforms: [.macOS(.v14)], products: [.executable(name: "voice-pack-batch", targets: ["VoicePackBatch"])], dependencies: [.package(name: "FluidAudio", path: sdk)], targets: [.target(name: "ProbeCore", dependencies: [.product(name: "FluidAudio", package: "FluidAudio")]), .executableTarget(name: "VoicePackBatch", dependencies: ["ProbeCore"])])
