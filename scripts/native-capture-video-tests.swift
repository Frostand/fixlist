import Foundation
import AVFoundation
import CoreVideo
import CryptoKit

@main enum ProductionVideoTests {
    // Rendezvous only on the deadline/caller threads, never on CaptureFiles.queue.
    final class DeadlinePause {
        private let condition = NSCondition()
        private var paused = false
        private var resumed = false
        func pause() {
            dispatchPrecondition(condition: .notOnQueue(CaptureFiles.queue))
            condition.lock(); defer { condition.unlock() }
            paused = true; condition.broadcast()
            while !resumed {
                precondition(condition.wait(until: Date().addingTimeInterval(12)), "Deadline pause released")
            }
        }
        var isPaused: Bool { condition.lock(); defer { condition.unlock() }; return paused }
        func resume() { condition.lock(); resumed = true; condition.broadcast(); condition.unlock() }
    }
    final class Trace {
        private let lock = NSLock()
        private var entries: [String] = []
        func add(_ entry: String) { lock.lock(); entries.append(entry); lock.unlock() }
        var events: [String] { lock.lock(); defer { lock.unlock() }; return entries }
    }
    static var checks = 0
    static func expect(_ value: @autoclosure () -> Bool, _ message: String) {
        checks += 1
        if !value() { print("FAIL: \(message)"); exit(1) }
    }
    static func wait(_ condition: () -> Bool, timeout: Double = 12) {
        let end = ProcessInfo.processInfo.systemUptime + timeout
        while !condition() && ProcessInfo.processInfo.systemUptime < end {
            RunLoop.current.run(until: Date().addingTimeInterval(0.003))
        }
        expect(condition(), "Callback completed without blocking the writer queue")
    }
    static func pixels(_ width: Int = 320, _ height: Int = 180) -> CVPixelBuffer {
        var buffer: CVPixelBuffer?
        expect(CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
                                  [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &buffer) == kCVReturnSuccess,
               "Allocate synthetic buffer")
        let image = buffer!
        CVPixelBufferLockBaseAddress(image, [])
        let base = CVPixelBufferGetBaseAddress(image)!.assumingMemoryBound(to: UInt8.self)
        for y in 0..<height { for x in 0..<width {
            let i = y * CVPixelBufferGetBytesPerRow(image) + x * 4
            base[i] = UInt8(x % 256); base[i+1] = UInt8(y % 256); base[i+2] = 180; base[i+3] = 255
        } }
        CVPixelBufferUnlockBaseAddress(image, [])
        return image
    }
    static func deadlineCancellationRace(buffer: CVPixelBuffer, resetAll: Bool, lateFinish: Bool = false) throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("fixlist-order-\(UUID())").resolvingSymlinksInPath()
        let directory = root.appendingPathComponent("cap-cancel-order")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let id = UUID(), trace = Trace(), pause = DeadlinePause()
        let candidate = directory.appendingPathComponent("candidate-\(id.uuidString.lowercased()).mp4")
        var failed = false, reviewed = false, removed = false
        var hooks = CaptureVideoWriter.TestHooks()
        hooks.holdFinish = !lateFinish; hooks.finishLimit = 0.05
        hooks.finishCallbackDelay = lateFinish ? 1.5 : 0
        hooks.afterDeadlineInvalidation = { pause.pause() }
        hooks.beforeFinishCallback = { trace.add("finish callback") }
        hooks.afterCancelWriting = {
            dispatchPrecondition(condition: .onQueue(CaptureFiles.queue))
            trace.add("cancelWriting returned")
        }
        let writer = CaptureVideoWriter(directory: directory, hooks: hooks) { _, event in
            if case .failed = event { failed = true }
            if case .review = event { reviewed = true }
        }
        CaptureFiles.queue.sync {
            CaptureFiles.didRemove = { url in
                dispatchPrecondition(condition: .onQueue(CaptureFiles.queue))
                if url == candidate { trace.add("candidate removed") }
            }
        }
        defer { CaptureFiles.queue.sync { CaptureFiles.didRemove = nil } }
        writer.start(generation: id, takenAt: "2026-10-24T01:02:03.000Z")
        CaptureFiles.queue.sync {}
        for frame in 0...20 {
            writer.submit(generation: id, buffer: buffer, timestamp: 1100 + Double(frame) / 15)
            CaptureFiles.queue.sync {}
            RunLoop.current.run(until: Date().addingTimeInterval(0.003))
        }
        expect(FileManager.default.fileExists(atPath: candidate.path), "Race fixture has a real writing candidate")
        writer.stop(generation: id)
        wait { pause.isPaused }
        // Prove the paused deadline does not occupy/block the serial file queue.
        CaptureFiles.queue.sync { trace.add("file queue responsive") }
        let callerStarted = DispatchSemaphore(value: 0), cleanup = DispatchGroup()
        cleanup.enter()
        DispatchQueue.global(qos: .userInitiated).async {
            callerStarted.signal()
            writer.discard()
            // Same ordering as plugin discard/discardAll: abort first, then enqueue
            // folder/root removal, then deliver cleanup resolution on the main queue.
            CaptureFiles.queue.async {
                try! CaptureFiles.remove(resetAll ? root : directory)
                trace.add("folder removed")
                cleanup.leave()
                DispatchQueue.main.async { trace.add("cleanup resolved"); removed = true }
            }
        }
        expect(callerStarted.wait(timeout: .now() + 12) == .success, "Competing discard started at the invalidation pause")
        // On the buggy path cleanup completes while the deadline is paused. With
        // atomic enqueue, discard waits for the admission lock. The bounded wait
        // is a deadlock escape, not the ordering assertion; the trace is evidence.
        _ = cleanup.wait(timeout: .now() + 0.5)
        pause.resume()
        wait { removed && failed }
        CaptureFiles.queue.sync {}
        let events = trace.events
        print("ORDER \(lateFinish ? "late finish" : resetAll ? "discardAll/reset" : "discard"): \(events.joined(separator: " -> "))")
        expect(events.firstIndex(of: "candidate removed").map { candidate in
            events.firstIndex(of: "folder removed").map { candidate < $0 } ?? false
        } ?? false, "Candidate removal precedes folder deletion/cleanup resolution")
        if !lateFinish {
            expect(events.firstIndex(of: "cancelWriting returned").map { cancel in
                events.firstIndex(of: "candidate removed").map { cancel < $0 } ?? false
            } ?? false, "Actual cancelWriting returns before candidate and folder deletion")
        }
        expect(events.firstIndex(of: "folder removed").map { folder in
            events.firstIndex(of: "cleanup resolved").map { folder < $0 } ?? false
        } ?? false, "Cleanup resolves after serial cancellation and deletion")
        if lateFinish {
            wait { trace.events.contains("finish callback") }
            expect(trace.events.firstIndex(of: "finish callback")! > trace.events.firstIndex(of: "cleanup resolved")!,
                   "Real finishWriting callback is delivered after folder cleanup")
        }
        expect(!reviewed && !writer.submit(generation: id, buffer: buffer, timestamp: 1103), "Timed-out generation cannot review or admit frames")
        var useRejected = false
        writer.use(generation: id) { if case .failure = $0 { useRejected = true } }
        wait { useRejected }
        expect(!FileManager.default.fileExists(atPath: directory.path), "Late Use cannot recreate or accept removed capture folder")
        if lateFinish { print("LATE: \(trace.events.joined(separator: " -> ")); Use rejected, folder absent") }
    }
    static func deadlineRetakeRace(buffer: CVPixelBuffer) throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("fixlist-retake-\(UUID())").resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let old = UUID(), newer = UUID(), pause = DeadlinePause()
        var failures = Set<UUID>(), started = false
        var hooks = CaptureVideoWriter.TestHooks()
        hooks.holdFinish = true; hooks.finishLimit = 0.05
        hooks.afterDeadlineInvalidation = { pause.pause() }
        let writer = CaptureVideoWriter(directory: directory, hooks: hooks) { id, event in
            if case .failed = event { failures.insert(id) }
        }
        writer.start(generation: old, takenAt: "2026-10-24T01:02:03.000Z")
        CaptureFiles.queue.sync {}
        for frame in 0...20 {
            writer.submit(generation: old, buffer: buffer, timestamp: 1200 + Double(frame) / 15)
            CaptureFiles.queue.sync {}
            RunLoop.current.run(until: Date().addingTimeInterval(0.003))
        }
        writer.stop(generation: old)
        wait { pause.isPaused }
        let callerStarted = DispatchSemaphore(value: 0), startReturned = DispatchGroup()
        startReturned.enter()
        DispatchQueue.global(qos: .userInitiated).async {
            callerStarted.signal()
            writer.start(generation: newer, takenAt: "2026-10-24T01:02:04.000Z")
            startReturned.leave()
            DispatchQueue.main.async { started = true }
        }
        expect(callerStarted.wait(timeout: .now() + 12) == .success, "Retake races paused deadline invalidation")
        _ = startReturned.wait(timeout: .now() + 0.5)
        pause.resume()
        wait { started && failures.contains(old) }
        CaptureFiles.queue.sync {}
        expect(writer.submit(generation: newer, buffer: buffer, timestamp: 1203), "Retake admits a new generation after deadline cleanup")
        CaptureFiles.queue.sync {}
        let oldURL = directory.appendingPathComponent("candidate-\(old.uuidString.lowercased()).mp4")
        let newURL = directory.appendingPathComponent("candidate-\(newer.uuidString.lowercased()).mp4")
        expect(!FileManager.default.fileExists(atPath: oldURL.path) && FileManager.default.fileExists(atPath: newURL.path),
               "Stale deadline cleanup removes only the old candidate")
        writer.stop(generation: old)
        var rejected = false
        writer.use(generation: old) { if case .failure = $0 { rejected = true } }
        wait { rejected }
        expect(writer.submit(generation: newer, buffer: buffer, timestamp: 1204), "Stale stop/Use cannot invalidate the new retake")
        CaptureFiles.queue.sync {}
        expect(!failures.contains(newer) && FileManager.default.fileExists(atPath: newURL.path), "New retake survives stale generation operations")
        writer.discard(); CaptureFiles.queue.sync {}
        expect(!FileManager.default.fileExists(atPath: newURL.path), "Discard still cancels and removes the new retake")
        print("RETAKE: newer candidate survives old deadline/stop/Use; discard removes newer candidate")
    }
    static func main() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("fixlist-synthetic-\(UUID())").resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        var reviews: [UUID: CaptureVideo] = [:]
        var failures = Set<UUID>()
        let writer = CaptureVideoWriter(directory: directory) { id, event in
            switch event {
            case .review(let clip): reviews[id] = clip
            case .failed: failures.insert(id)
            case .finishing: break
            }
        }
        let buffer = pixels()
        func append(_ id: UUID, _ timestamp: Double) {
            _ = writer.submit(generation: id, buffer: buffer, timestamp: timestamp)
            CaptureFiles.queue.sync {}
            RunLoop.current.run(until: Date().addingTimeInterval(0.003))
        }
        func record(_ id: UUID, frames: [Double]) {
            writer.start(generation: id, takenAt: "2026-10-24T01:02:03.000Z")
            CaptureFiles.queue.sync {}
            for time in frames { append(id, time) }
            writer.stop(generation: id)
            wait { reviews[id] != nil || failures.contains(id) }
        }
        let first = UUID()
        record(first, frames: (0..<31).map { 100 + Double($0) / 15 })
        expect(reviews[first] != nil && !failures.contains(first), "Actual H.264 output validates")
        let clip = reviews[first]!
        expect(Thread.isMainThread, "UI events use main thread")
        expect(clip.width == 180 && clip.height == 320, "Portrait pixels, no upscale")
        expect(clip.durationMs >= 1000 && clip.durationMs <= 30000 && clip.byteLength <= 12_582_912, "Media bounds")
        expect(clip.sha256 == SHA256.hash(data: try! Data(contentsOf: clip.url)).map { String(format: "%02x", $0) }.joined(), "Streaming SHA matches independent hash")
        let movie = try Data(contentsOf: clip.url)
        func uint32(_ offset: Int) -> Int { (0..<4).reduce(0) { ($0 << 8) | Int(movie[offset + $1]) } }
        func boxes(_ start: Int, _ end: Int) -> [(String, Int, Int)] {
            var cursor = start
            var result: [(String, Int, Int)] = []
            while cursor < end {
                expect(cursor + 8 <= end, "Bounded MP4 box header")
                let small = uint32(cursor)
                let header = small == 1 ? 16 : 8
                expect(cursor + header <= end, "Bounded extended box header")
                let length = small == 0 ? end - cursor : small == 1 ? (0..<8).reduce(0) { ($0 << 8) | Int(movie[cursor + 8 + $1]) } : small
                expect(length >= header && cursor + length <= end, "Bounded MP4 box length")
                result.append((String(data: movie[(cursor+4)..<(cursor+8)], encoding: .ascii)!, cursor+header, cursor+length))
                cursor += length
            }
            return result
        }
        let top = boxes(0, movie.count)
        expect(top.contains { $0.0 == "ftyp" } && top.contains { $0.0 == "moov" } && top.contains { $0.0 == "mdat" }
               && !top.contains { $0.0 == "moof" }, "Actual self-contained nonfragmented MP4 boxes")
        let moov = top.first { $0.0 == "moov" }!
        expect(!boxes(moov.1, moov.2).contains { $0.0 == "mvex" }, "No fragmented movie extension")
        var children = boxes(moov.1, moov.2)
        for name in ["trak", "mdia", "minf", "dinf"] {
            let entry = children.first { $0.0 == name }!
            children = boxes(entry.1, entry.2)
        }
        let reference = children.first { $0.0 == "dref" }!
        expect(uint32(reference.1 + 4) == 1, "Exactly one data reference")
        let entry = boxes(reference.1 + 8, reference.2)[0]
        expect(entry.0 == "url " && uint32(entry.1) == 1 && entry.2 - entry.1 == 4, "Video data reference is internal without external URL")
        if CommandLine.arguments.count == 2 {
            try movie.write(to: URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("native-180x320.mp4"), options: .atomic)
        }
        var accepted: CaptureVideo?
        writer.use(generation: first) { if case .success(let value) = $0 { accepted = value } }
        wait { accepted != nil }
        expect(accepted!.url.lastPathComponent == "v01.mp4", "Exact accepted filename")
        let acceptedBytes = try Data(contentsOf: accepted!.url)
        let short = UUID()
        record(short, frames: [200, 200.1])
        expect(failures.contains(short), "Short clips fail without stretching to minimum")
        expect((try! Data(contentsOf: accepted!.url)) == acceptedBytes, "Failed retake preserves accepted v01")
        // Independently inspect compressed sample timestamps from the real encoded asset.
        func sampleTimes(_ url: URL) -> [Double] {
            var result: [Double]?
            Task {
                let asset = AVURLAsset(url: url)
                let tracks = try! await asset.load(.tracks)
                let transform = try! await tracks[0].load(.preferredTransform)
                let descriptions = try! await tracks[0].load(.formatDescriptions)
                let metadata = try! await asset.load(.metadata)
                expect(tracks.count == 1 && tracks[0].mediaType == .video && transform == .identity && metadata.isEmpty,
                       "Independent AVAsset check: one video, identity, no descriptive metadata")
                expect(descriptions.allSatisfy { CMFormatDescriptionGetMediaSubType($0) == kCMVideoCodecType_H264 }, "Actual avc1 format")
                let reader = try! AVAssetReader(asset: asset)
                let output = AVAssetReaderTrackOutput(track: tracks[0], outputSettings: nil)
                reader.add(output); expect(reader.startReading(), "Read encoded sample times")
                var times: [Double] = []
                while let sample = output.copyNextSampleBuffer() {
                    // The compressed reader also emits zero-byte configuration/end markers.
                    let pts = CMSampleBufferGetPresentationTimeStamp(sample)
                    if CMSampleBufferGetNumSamples(sample) > 0 && CMSampleBufferGetTotalSampleSize(sample) > 0 && pts.isNumeric { times.append(pts.seconds) }
                }
                expect(reader.status == .completed, "Independent compressed sample reader completes")
                await MainActor.run { result = times }
            }
            wait { result != nil }
            return result!
        }
        let firstTimes = sampleTimes(accepted!.url)
        expect(firstTimes.count >= 2 && firstTimes.last! >= 1.9, "Actual first/last samples span recorded elapsed time")
        // Full-size output and dense camera callbacks exercise the actual CI transform/rate limiter.
        expect(CaptureVideoWriter.dimensions(sensorWidth: 1920, sensorHeight: 1080) == CGSize(width: 720, height: 1280), "720x1280 ceiling")
        expect(CaptureVideoWriter.dimensions(sensorWidth: 321, sensorHeight: 181) == CGSize(width: 180, height: 320), "Even output without upscale on odd inputs")
        let dense = UUID()
        record(dense, frames: (0...120).map { 300 + Double($0) / 60 })
        expect(reviews[dense] != nil, "60 fps source is sampled at <=15 fps")
        let denseTimes = sampleTimes(reviews[dense]!.url)
        expect(denseTimes.count <= 31 && zip(denseTimes, denseTimes.dropFirst()).allSatisfy { $1 - $0 + 0.000_002 >= 1.0 / 15 },
               "Independent actual media samples prove <=15 fps")
        let gaps = UUID()
        record(gaps, frames: [400, 400.1, 400.2, 401.9, 402])
        expect(reviews[gaps]?.durationMs == 2067, "Elapsed gaps survive encoding instead of shortening time")
        let gapTimes = sampleTimes(reviews[gaps]!.url)
        expect(zip(gapTimes, gapTimes.dropFirst()).contains { $1 - $0 > 1 }, "Actual sample timeline preserves long gaps")
        let nearRate = UUID()
        record(nearRate, frames: (0...35).map { 500 + Double($0) * 0.062 })
        expect(reviews[nearRate] != nil, "62 ms input does not become a >15 fps output")
        let nearTimes = sampleTimes(reviews[nearRate]!.url)
        expect(zip(nearTimes, nearTimes.dropFirst()).allSatisfy { $1 - $0 + 0.000_002 >= 1.0 / 15 }, "62ms arrivals cannot exceed rate cap")
        let limit = UUID()
        record(limit, frames: (0...451).map { 600 + Double($0) / 15 })
        expect(reviews[limit].map { $0.durationMs > 29000 && $0.durationMs <= 30000 } ?? false, "Actual media is capped at 30 seconds: \(String(describing: reviews[limit]?.durationMs)), failed=\(failures.contains(limit))")
        expect((try! Data(contentsOf: accepted!.url)) == acceptedBytes, "Unaccepted valid retakes preserve v01")
        let full = UUID()
        let fullBuffer = pixels(1920, 1080)
        writer.start(generation: full, takenAt: "2026-10-24T01:02:03.000Z")
        CaptureFiles.queue.sync {}
        for frame in 0...17 {
            writer.submit(generation: full, buffer: fullBuffer, timestamp: 650 + Double(frame) / 15)
            CaptureFiles.queue.sync {}
            RunLoop.current.run(until: Date().addingTimeInterval(0.003))
        }
        writer.stop(generation: full); wait { reviews[full] != nil || failures.contains(full) }
        expect(reviews[full]?.width == 720 && reviews[full]?.height == 1280, "Production CI renderer and encoder create bounded full portrait")
        let fullClip = reviews[full]!
        if CommandLine.arguments.count == 2 {
            try Data(contentsOf: fullClip.url).write(to: URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("native-720x1280.mp4"), options: .atomic)
        }
        print("MEDIA FULL: \(fullClip.width)x\(fullClip.height), \(fullClip.durationMs) ms, \(fullClip.byteLength) bytes")
        let replacement = UUID()
        record(replacement, frames: (0...20).map { 700 + Double($0) / 15 })
        var replaced: CaptureVideo?
        writer.use(generation: replacement) { if case .success(let value) = $0 { replaced = value } }
        wait { replaced != nil }
        let replacementBytes = try Data(contentsOf: replaced!.url)
        expect(replacementBytes != acceptedBytes && replaced!.url == accepted!.url, "Use atomically replaces the same v01 path")
        var asyncValidation: Result<CaptureVideo, Error>?
        func validate(_ url: URL) -> Bool {
            asyncValidation = nil
            Task {
                do { let result = try await CaptureVideoWriter.validate(url: url, takenAt: "2026-10-24T01:02:03.000Z")
                    await MainActor.run { asyncValidation = .success(result) }
                } catch { await MainActor.run { asyncValidation = .failure(error) } }
            }
            wait { asyncValidation != nil }
            if case .success = asyncValidation! { return true }
            return false
        }
        let oversized = directory.appendingPathComponent("oversize.mp4")
        try replacementBytes.write(to: oversized)
        let large = try FileHandle(forWritingTo: oversized)
        try large.truncate(atOffset: UInt64(CaptureVideoWriter.maximumBytes + 1)); try large.close()
        expect(!validate(oversized), "Actual oversized file rejected before decoding")
        try FileManager.default.removeItem(at: oversized)
        let truncated = directory.appendingPathComponent("truncated.mp4")
        try replacementBytes.prefix(128).write(to: truncated)
        expect(!validate(truncated), "Truncated output rejected")
        try FileManager.default.removeItem(at: truncated)
        let alias = directory.appendingPathComponent("alias.mp4")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: replaced!.url)
        expect(!validate(alias), "Aliased file rejected")
        try FileManager.default.removeItem(at: alias)

        // Produce real metadata/audio/transform variants from synthetic media for rejection checks.
        func variant(metadata: Bool = false, rotated: Bool = false, audio: Bool = false) -> URL {
            var result: URL?
            Task {
                let asset = AVURLAsset(url: replaced!.url)
                let duration = try! await asset.load(.duration)
                let source = try! await asset.loadTracks(withMediaType: .video)[0]
                let composition = AVMutableComposition()
                let video = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
                try! video.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: source, at: .zero)
                if rotated { video.preferredTransform = CGAffineTransform(rotationAngle: .pi / 2) }
                if audio {
                    let soundURL = directory.appendingPathComponent("synthetic-silence.wav")
                    let format = AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1)!
                    let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16_000)!
                    pcm.frameLength = 16_000
                    pcm.floatChannelData![0].initialize(repeating: 0, count: 16_000)
                    do { let sound = try! AVAudioFile(forWriting: soundURL, settings: format.settings); try! sound.write(from: pcm) }
                    let sound = AVURLAsset(url: soundURL)
                    let soundTrack = try! await sound.loadTracks(withMediaType: .audio)[0]
                    let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
                    try! track.insertTimeRange(CMTimeRange(start: .zero, duration: CMTime(seconds: 1, preferredTimescale: 16000)), of: soundTrack, at: .zero)
                }
                let destination = directory.appendingPathComponent("variant-\(UUID()).mp4")
                let export = AVAssetExportSession(asset: composition, presetName: audio ? AVAssetExportPresetHighestQuality : AVAssetExportPresetPassthrough)!
                if metadata {
                    let title = AVMutableMetadataItem()
                    title.keySpace = .common; title.key = AVMetadataKey.commonKeyTitle as NSString; title.value = "Synthetic test only" as NSString
                    export.metadata = [title]
                }
                try! await export.export(to: destination, as: .mp4)
                expect(FileManager.default.fileExists(atPath: destination.path), "Create real synthetic variant")
                await MainActor.run { result = destination }
            }
            wait { result != nil }
            return result!
        }
        expect(!validate(variant(metadata: true)), "Real descriptive metadata rejected")
        expect(!validate(variant(rotated: true)), "Real nonidentity playback transform rejected")
        expect(!validate(variant(audio: true)), "Real additional audio track rejected")

        func faultWriter(_ hooks: CaptureVideoWriter.TestHooks) -> CaptureVideoWriter {
            CaptureVideoWriter(directory: directory, hooks: hooks) { id, event in
                switch event {
                case .failed: failures.insert(id)
                case .review(let clip): reviews[id] = clip
                case .finishing: break
                }
            }
        }
        func feed(_ target: CaptureVideoWriter, _ id: UUID) {
            target.start(generation: id, takenAt: "2026-10-24T01:02:03.000Z")
            CaptureFiles.queue.sync {}
            for frame in 0...20 {
                target.submit(generation: id, buffer: buffer, timestamp: 800 + Double(frame) / 15)
                CaptureFiles.queue.sync {}
                RunLoop.current.run(until: Date().addingTimeInterval(0.003))
            }
        }
        var hooks = CaptureVideoWriter.TestHooks(); hooks.failAppend = true
        let appendFailure = faultWriter(hooks), appendID = UUID()
        feed(appendFailure, appendID)
        wait { failures.contains(appendID) }
        expect(reviews[appendID] == nil, "Real encoder append failure never becomes review")
        hooks = CaptureVideoWriter.TestHooks(); hooks.failFinish = true
        let finishFailure = faultWriter(hooks), finishID = UUID()
        feed(finishFailure, finishID); finishFailure.stop(generation: finishID)
        wait { failures.contains(finishID) }
        expect(reviews[finishID] == nil, "Finalization failure never becomes review")
        hooks = CaptureVideoWriter.TestHooks(); hooks.holdFinish = true; hooks.finishLimit = 0.12
        let deadlineWriter = faultWriter(hooks), deadlineID = UUID()
        feed(deadlineWriter, deadlineID)
        let candidatePath = directory.appendingPathComponent("candidate-\(deadlineID.uuidString.lowercased()).mp4")
        CaptureFiles.queue.suspend()
        deadlineWriter.stop(generation: deadlineID)
        wait { failures.contains(deadlineID) }
        expect(FileManager.default.fileExists(atPath: candidatePath.path), "Deadline reports failure while blocked cleanup honestly remains pending")
        expect(!deadlineWriter.submit(generation: deadlineID, buffer: buffer, timestamp: 803), "Deadline immediately invalidates admission")
        CaptureFiles.queue.resume(); CaptureFiles.queue.sync {}
        expect(!FileManager.default.fileExists(atPath: candidatePath.path), "Queued cancellation removes candidate when queue becomes available")
        hooks = CaptureVideoWriter.TestHooks(); hooks.finishLimit = 0.12; hooks.finishCallbackDelay = 0.3
        let lateWriter = faultWriter(hooks), lateID = UUID()
        feed(lateWriter, lateID); lateWriter.stop(generation: lateID)
        wait { failures.contains(lateID) }
        RunLoop.current.run(until: Date().addingTimeInterval(0.35))
        expect(reviews[lateID] == nil, "Late real finish callback cannot revive timed-out candidate")
        hooks = CaptureVideoWriter.TestHooks(); hooks.wallLimit = 0.1
        let wallWriter = faultWriter(hooks), wallID = UUID()
        wallWriter.start(generation: wallID, takenAt: "2026-10-24T01:02:03.000Z")
        wait { failures.contains(wallID) }
        expect(reviews[wallID] == nil, "Wall deadline fires without incoming frames")
        expect((try! Data(contentsOf: replaced!.url)) == replacementBytes, "Every failed attempt preserves accepted v01")

        // Invalidation between Use's initial guard and rename must preserve the old accepted bytes.
        var racingWriter: CaptureVideoWriter!
        hooks = CaptureVideoWriter.TestHooks()
        hooks.beforeCommit = { racingWriter.discard() }
        racingWriter = faultWriter(hooks)
        let racingID = UUID()
        feed(racingWriter, racingID); racingWriter.stop(generation: racingID)
        wait { reviews[racingID] != nil || failures.contains(racingID) }
        expect(reviews[racingID] != nil, "Race fixture is a validated real take")
        var rejectedUse = false
        racingWriter.use(generation: racingID) { if case .failure = $0 { rejectedUse = true } }
        wait { rejectedUse }
        expect((try! Data(contentsOf: replaced!.url)) == replacementBytes, "Interruption racing atomic replacement keeps previously accepted bytes")

        // Queue a burst from concurrent callers: only one frame operation may be pending/executing.
        let burstID = UUID()
        writer.start(generation: burstID, takenAt: "2026-10-24T01:02:03.000Z")
        CaptureFiles.queue.sync {}
        CaptureFiles.queue.suspend()
        let lock = NSLock()
        var admitted = 0
        DispatchQueue.concurrentPerform(iterations: 200) { index in
            if writer.submit(generation: burstID, buffer: buffer, timestamp: 900 + Double(index) / 60) {
                lock.lock(); admitted += 1; lock.unlock()
            }
        }
        expect(admitted == 1, "Exactly one frame operation across 200 concurrent submissions")
        writer.discard()
        let newerID = UUID()
        writer.start(generation: newerID, takenAt: "2026-10-24T01:02:03.000Z")
        expect(!writer.submit(generation: newerID, buffer: buffer, timestamp: 1000), "Generation change cannot release an older pending slot")
        CaptureFiles.queue.resume(); CaptureFiles.queue.sync {}
        expect(writer.submit(generation: newerID, buffer: buffer, timestamp: 1000), "Slot releases only when old operation exits")
        CaptureFiles.queue.sync {}
        writer.discard()
        CaptureFiles.queue.sync {}
        expect((try! Data(contentsOf: replaced!.url)) == replacementBytes, "Cancellation preserves accepted clip")
        expect(!writer.submit(generation: newerID, buffer: buffer, timestamp: 1001), "Cancelled generation rejects late frame")

        // Cancellation is enqueued before folder removal; delayed callbacks never recreate it.
        let abortID = UUID()
        feed(writer, abortID)
        writer.stop(generation: abortID)
        writer.discard()
        var removed = false
        CaptureFiles.queue.async {
            try! FileManager.default.removeItem(at: directory)
            DispatchQueue.main.async { removed = true }
        }
        wait { removed }
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        expect(!FileManager.default.fileExists(atPath: directory.path) && reviews[abortID] == nil, "Abort/remove cannot resurrect candidate or folder")
        try deadlineCancellationRace(buffer: buffer, resetAll: false)
        try deadlineCancellationRace(buffer: buffer, resetAll: true)
        try deadlineCancellationRace(buffer: buffer, resetAll: true, lateFinish: true)
        try deadlineRetakeRace(buffer: buffer)
        print("MEDIA: \(clip.width)x\(clip.height), \(clip.durationMs) ms, \(clip.byteLength) bytes, avc1, silent; first and last actual samples decoded")
        print("PASS: \(checks) real production video checks")
    }
}
