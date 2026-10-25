@preconcurrency import FluidAudio
@preconcurrency import CoreML
import Foundation
import Darwin

public struct ProbeAudio: Sendable {
    public let wav: Data
    public let synthesisSeconds: Double
}

/// The UI retains the single-flight slot until each detached job drains, even after cancellation.
/// This actor also rejects reentrant inference while a previous synthesize call is suspended.
public actor ProbeBackend {
    private var manager: KokoroTtsManager?
    private var running = false
    private let root: URL
    private let log: ProbeLog
    public init(root: URL, log: ProbeLog) { self.root = root; self.log = log }
    public func synthesize(_ text: String) async throws -> ProbeAudio {
        guard !running else { throw ProbeFailure.invalid("Synthesis already running") }
        running = true
        defer { running = false }
        try Task.checkCancellation()
        guard pthread_main_np() == 0 else { throw ProbeFailure.invalid("Inference must run off the main thread") }
        if manager == nil { try await initialize() }
        try Task.checkCancellation()
        guard let manager else { throw ProbeFailure.invalid("Backend unavailable") }
        let start = ProcessInfo.processInfo.systemUptime
        log.event("synthesis_started", fields: ["text": text, "voice": "af_heart", "variant": "fifteenSecond"])
        let data = try await manager.synthesize(text: text, voice: "af_heart", variantPreference: .fifteenSecond)
        try Task.checkCancellation()
        let elapsed = ProcessInfo.processInfo.systemUptime - start
        log.event("audio_ready", fields: ["synthesis_s": String(elapsed), "wav_bytes": String(data.count)])
        return ProbeAudio(wav: data, synthesisSeconds: elapsed)
    }
    private func initialize() async throws {
        let start = ProcessInfo.processInfo.systemUptime
        log.event("verifying_assets")
        let count = try AssetVerifier.verify(root: root)
        log.event("assets_verified", fields: ["asset_bytes": String(count), "hash_s": String(ProcessInfo.processInfo.systemUptime - start)])
        try ProbeOfflineAssets.configure(root: root)
        try Task.checkCancellation()
        let config = MLModelConfiguration()
        config.computeUnits = .cpuAndGPU
        let modelStart = ProcessInfo.processInfo.systemUptime
        log.event("loading_coreml", fields: ["compute_policy": "cpuAndGPU (requested; actual placement unverified)"])
        let model = try MLModel(contentsOf: ProbeOfflineAssets.require("kokoro_21_15s.mlmodelc"), configuration: config)
        log.event("coreml_loaded", fields: ["model_load_s": String(ProcessInfo.processInfo.systemUptime - modelStart)])
        try Task.checkCancellation()
        let backendStart = ProcessInfo.processInfo.systemUptime
        log.event("initializing_kokoro")
        let candidate = KokoroTtsManager(defaultVoice: "af_heart", computeUnits: .cpuAndGPU)
        try await candidate.initialize(models: TtsModels(models: [.fifteenSecond: model]), preloadVoices: ["af_heart"])
        try Task.checkCancellation()
        log.event("loading_g2p")
        try await ProbeOfflineAssets.validateG2P()
        try Task.checkCancellation()
        manager = candidate
        log.event("backend_ready", fields: ["kokoro_and_g2p_init_s": String(ProcessInfo.processInfo.systemUptime - backendStart), "total_initialization_s": String(ProcessInfo.processInfo.systemUptime - start)])
    }
}
