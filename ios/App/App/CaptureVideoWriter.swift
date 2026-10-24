import AVFoundation
import CoreImage
import CryptoKit
import Foundation
import CoreVideo
import Darwin

/// Video is a separate sidecar; it never changes the v1 photo manifest.
struct CaptureVideo: Sendable {
    let takenAt: String
    let width: Int
    let height: Int
    let durationMs: Int
    let byteLength: Int
    let sha256: String
    let url: URL
    var json: [String: Any] {
        ["videoId": "v01", "takenAt": takenAt, "mimeType": "video/mp4", "codec": "avc1",
         "width": width, "height": height, "durationMs": durationMs, "byteLength": byteLength, "sha256": sha256]
    }
    func at(_ url: URL) -> CaptureVideo {
        CaptureVideo(takenAt: takenAt, width: width, height: height, durationMs: durationMs,
                     byteLength: byteLength, sha256: sha256, url: url)
    }
}

/// This small lock protects admission/invalidation, never AVFoundation state.
/// A slot remains occupied across generation changes until its operation exits.
private final class CaptureVideoAdmission {
    private let lock = NSLock()
    private var current: UUID?
    private var accepting = false
    private var pending = false
    private var finalizing = false
    func start(_ id: UUID, enqueue: () -> Void) {
        lock.lock(); defer { lock.unlock() }
        current = id; accepting = true; finalizing = false
        enqueue()
    }
    func acquire(_ id: UUID, enqueue: () -> Void) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard current == id, accepting, !pending else { return false }
        pending = true
        enqueue() // Enqueue under the lock, so stop is always behind every admitted append.
        return true
    }
    func commit(_ id: UUID, replace: () -> Bool) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard current == id, !accepting, !finalizing, replace() else { return false }
        current = nil
        return true
    }
    func release() { lock.lock(); pending = false; lock.unlock() }
    func valid(_ id: UUID) -> Bool { lock.lock(); defer { lock.unlock() }; return current == id }
    func stop(_ id: UUID) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard current == id, accepting else { return false }
        accepting = false; finalizing = true; return true
    }
    func reviewed(_ id: UUID) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard current == id, finalizing else { return false }
        finalizing = false; return true
    }
    func invalidate(_ id: UUID? = nil, onlyFinalizing: Bool = false) -> UUID? {
        lock.lock(); defer { lock.unlock() }
        guard let value = current, id == nil || id == value, !onlyFinalizing || finalizing else { return nil }
        current = nil; accepting = false; finalizing = false; return value
    }
}

// AV state and the CIContext are confined to CaptureFiles.queue; admission uses its own lock.
final class CaptureVideoWriter: @unchecked Sendable {
    enum Event { case finishing, review(CaptureVideo), failed }
    enum Failure: Error { case invalidMedia, writer, cancelled, file }
    static let maximumBytes = 12_582_912
    static let frameInterval = CMTime(value: 1, timescale: 15)
    static let maximumDuration = 30.0
    private let directory: URL
    private let onEvent: (UUID, Event) -> Void
    private let admission = CaptureVideoAdmission()
    private let context = CIContext(options: [.cacheIntermediates: false])
    private let colorSpace = CGColorSpaceCreateDeviceRGB()
    private var attempt: Attempt? // All access, including deletes, is on CaptureFiles.queue.

    #if CAPTURE_VIDEO_TESTING
    struct TestHooks {
        var failAppend = false
        var failFinish = false
        var holdFinish = false
        var finishCallbackDelay = 0.0
        var beforeAppend: (() -> Void)?
        var beforeCommit: (() -> Void)?
        var wallLimit = 30.0
        var finishLimit = 10.0
    }
    private let hooks: TestHooks
    init(directory: URL, hooks: TestHooks = TestHooks(), onEvent: @escaping (UUID, Event) -> Void) {
        self.directory = directory.standardizedFileURL.resolvingSymlinksInPath(); self.hooks = hooks; self.onEvent = onEvent
    }
    #else
    init(directory: URL, onEvent: @escaping (UUID, Event) -> Void) {
        self.directory = directory.standardizedFileURL.resolvingSymlinksInPath(); self.onEvent = onEvent
    }
    #endif

    private final class Attempt: @unchecked Sendable {
        let id: UUID
        let url: URL
        let takenAt: String
        let started: Double
        var writer: AVAssetWriter?
        var input: AVAssetWriterInput?
        var adaptor: AVAssetWriterInputPixelBufferAdaptor?
        var dimensions: CGSize?
        var sourceSize: CGSize?
        var firstTime: CMTime?
        var lastTime: CMTime?
        var candidate: CaptureVideo?
        var finishing = false
        init(id: UUID, url: URL, takenAt: String, started: Double) {
            self.id = id; self.url = url; self.takenAt = takenAt; self.started = started
        }
    }

    func start(generation: UUID, takenAt: String) {
        let started = ProcessInfo.processInfo.systemUptime
        admission.start(generation) {
            CaptureFiles.queue.async {
                self.clearAttempt()
                guard self.admission.valid(generation) else { return }
                // Never create the directory here: an old callback must not resurrect a discarded capture.
                guard self.directory.isFileURL, self.directory.standardizedFileURL.path == self.directory.path,
                      self.directory.resolvingSymlinksInPath().path == self.directory.path,
                      (try? self.directory.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else {
                    self.fail(generation); return
                }
                let url = self.directory.appendingPathComponent("candidate-\(generation.uuidString.lowercased()).mp4")
                self.attempt = Attempt(id: generation, url: url, takenAt: takenAt, started: started)
            }
        }
        var limit = Self.maximumDuration
        #if CAPTURE_VIDEO_TESTING
        limit = hooks.wallLimit
        #endif
        // A monotonic timer closes admission even when no AR frames arrive.
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + limit) { [weak self] in
            self?.stop(generation: generation)
        }
    }

    @discardableResult func submit(generation: UUID, buffer: CVPixelBuffer, timestamp: Double) -> Bool {
        guard timestamp.isFinite else { return false }
        // Capture only these immutable values, never ARFrame or ARCamera.
        return admission.acquire(generation) {
            CaptureFiles.queue.async {
                defer { self.admission.release() }
                guard self.admission.valid(generation), let attempt = self.attempt, attempt.id == generation,
                      !attempt.finishing else { return }
                #if CAPTURE_VIDEO_TESTING
                self.hooks.beforeAppend?()
                #endif
                do { try self.append(buffer, timestamp: timestamp, to: attempt) }
                catch { self.fail(generation) }
            }
        }
    }

    static func dimensions(sensorWidth: Int, sensorHeight: Int) -> CGSize? {
        guard sensorWidth >= sensorHeight, sensorHeight >= 2 else { return nil }
        let scale = min(1, 720 / Double(sensorHeight), 1280 / Double(sensorWidth))
        let width = Int(Double(sensorHeight) * scale) / 2 * 2
        let height = Int(Double(sensorWidth) * scale) / 2 * 2
        guard width >= 2, height >= 2 else { return nil }
        return CGSize(width: width, height: height)
    }

    private func append(_ buffer: CVPixelBuffer, timestamp: Double, to a: Attempt) throws {
        guard ProcessInfo.processInfo.systemUptime - a.started <= Self.maximumDuration else {
            stop(generation: a.id); return
        }
        let time = CMTime(seconds: timestamp, preferredTimescale: 600_000)
        if let last = a.lastTime, CMTimeCompare(CMTimeSubtract(time, last), Self.frameInterval) < 0 { return }
        let first = a.firstTime ?? time
        let elapsed = CMTimeSubtract(time, first)
        guard elapsed.seconds >= 0, elapsed.seconds < Self.maximumDuration else { stop(generation: a.id); return }
        if a.writer == nil { try configure(buffer, attempt: a) }
        guard let writer = a.writer, let input = a.input, let adaptor = a.adaptor,
              let size = a.dimensions, a.sourceSize == CGSize(width: CVPixelBufferGetWidth(buffer), height: CVPixelBufferGetHeight(buffer)),
              writer.status == .writing else { throw Failure.writer }
        guard input.isReadyForMoreMediaData else { return } // Backpressure drops frames, preserving time gaps.
        guard let pool = adaptor.pixelBufferPool else { throw Failure.writer }
        var output: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &output) == kCVReturnSuccess,
              let output = output else { throw Failure.writer }
        CVBufferRemoveAllAttachments(output)
        let upright = CIImage(cvPixelBuffer: buffer).oriented(.right)
        let scale = min(size.width / upright.extent.width, size.height / upright.extent.height)
        // Uniform fit preserves the entire image/aspect. Even rounding may add <2px of black, never a crop/stretch.
        let image = upright.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
            .transformed(by: CGAffineTransform(translationX: (size.width - upright.extent.width * scale) / 2,
                                               y: (size.height - upright.extent.height * scale) / 2))
        let rect = CGRect(origin: .zero, size: size)
        let composite = image.composited(over: CIImage(color: .black).cropped(to: rect))
        context.render(composite, to: output, bounds: rect, colorSpace: colorSpace)
        #if CAPTURE_VIDEO_TESTING
        if hooks.failAppend { throw Failure.writer }
        #endif
        guard adaptor.append(output, withPresentationTime: elapsed) else { throw Failure.writer }
        a.firstTime = first; a.lastTime = time
        if let bytes = try FileManager.default.attributesOfItem(atPath: a.url.path)[.size] as? NSNumber,
           bytes.intValue > Self.maximumBytes { throw Failure.invalidMedia }
    }

    private func configure(_ buffer: CVPixelBuffer, attempt a: Attempt) throws {
        guard let size = Self.dimensions(sensorWidth: CVPixelBufferGetWidth(buffer), sensorHeight: CVPixelBufferGetHeight(buffer))
        else { throw Failure.invalidMedia }
        let writer = try AVAssetWriter(outputURL: a.url, fileType: .mp4)
        a.writer = writer // Retain partial setup so every failure can cancel/remove it.
        writer.metadata = []
        writer.movieFragmentInterval = .invalid
        writer.shouldOptimizeForNetworkUse = false
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: Int(size.width), AVVideoHeightKey: Int(size.height),
            AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 2_000_000,
                AVVideoExpectedSourceFrameRateKey: 15, AVVideoMaxKeyFrameIntervalKey: 15,
                AVVideoAllowFrameReorderingKey: false, AVVideoProfileLevelKey: AVVideoProfileLevelH264MainAutoLevel]
        ])
        input.expectsMediaDataInRealTime = true
        input.transform = .identity
        input.metadata = []
        // The iOS-15 adaptor is intentional; newer SDKs deprecate it without removing it.
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: Int(size.width), kCVPixelBufferHeightKey as String: Int(size.height),
            kCVPixelBufferIOSurfacePropertiesKey as String: [:]
        ])
        guard writer.canAdd(input) else { throw Failure.writer }
        writer.add(input)
        guard writer.startWriting() else { throw Failure.writer }
        writer.startSession(atSourceTime: .zero)
        try Self.protect(a.url)
        a.input = input; a.adaptor = adaptor; a.dimensions = size
        a.sourceSize = CGSize(width: CVPixelBufferGetWidth(buffer), height: CVPixelBufferGetHeight(buffer))
    }

    func stop(generation: UUID) {
        guard admission.stop(generation) else { return }
        emit(generation, .finishing)
        var deadline = 10.0
        #if CAPTURE_VIDEO_TESTING
        deadline = hooks.finishLimit
        #endif
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + deadline) { [weak self] in
            guard let self = self, self.admission.invalidate(generation, onlyFinalizing: true) != nil else { return }
            self.emit(generation, .failed)
            // cancelWriting can block. Failure is visible now; cleanup is still pending on the serial queue.
            self.enqueueClear(generation)
        }
        CaptureFiles.queue.async {
            guard self.admission.valid(generation), let a = self.attempt, a.id == generation,
                  !a.finishing, let writer = a.writer, let input = a.input,
                  let first = a.firstTime, let last = a.lastTime, writer.status == .writing else {
                self.fail(generation); return
            }
            a.finishing = true
            let end = CMTimeMinimum(CMTimeAdd(CMTimeSubtract(last, first), Self.frameInterval), CMTime(seconds: 30, preferredTimescale: 600_000))
            // Never extend a sparse/short take to the minimum duration.
            guard end.seconds >= 1 else { self.fail(generation); return }
            writer.endSession(atSourceTime: end)
            input.markAsFinished()
            #if CAPTURE_VIDEO_TESTING
            if self.hooks.failFinish { self.fail(generation); return }
            if self.hooks.holdFinish { return }
            #endif
            writer.finishWriting {
                var delay = 0.0
                #if CAPTURE_VIDEO_TESTING
                delay = self.hooks.finishCallbackDelay
                #endif
                CaptureFiles.queue.asyncAfter(deadline: .now() + delay) {
                    guard self.admission.valid(generation), self.attempt === a else { return }
                    guard writer.status == .completed else { self.fail(generation); return }
                    do { try Self.protect(a.url) } catch { self.fail(generation); return }
                    Task {
                        do {
                            let video = try await Self.validate(url: a.url, takenAt: a.takenAt)
                              CaptureFiles.queue.async {
                                guard self.attempt === a, self.admission.reviewed(generation) else { return }
                                a.candidate = video
                                self.emit(generation, .review(video))
                            }
                        } catch { CaptureFiles.queue.async { self.fail(generation) } }
                    }
                }
            }
        }
    }

    func use(generation: UUID, completion: @escaping (Result<CaptureVideo, Error>) -> Void) {
        CaptureFiles.queue.async {
            guard self.admission.valid(generation), let a = self.attempt, a.id == generation,
                  let video = a.candidate else {
                DispatchQueue.main.async { completion(.failure(Failure.cancelled)) }; return
            }
            let final = self.directory.appendingPathComponent("v01.mp4")
            // POSIX rename is an atomic replacement on this same directory/filesystem.
            // Until it succeeds, the previous accepted clip is untouched.
            #if CAPTURE_VIDEO_TESTING
            self.hooks.beforeCommit?()
            #endif
            guard self.admission.commit(generation, replace: { rename(video.url.path, final.path) == 0 }) else {
                DispatchQueue.main.async { completion(.failure(Failure.file)) }; return
            }
            self.attempt = nil
            DispatchQueue.main.async { completion(.success(video.at(final))) }
        }
    }

    /// Invalidate synchronously, then enqueue cancellation BEFORE caller dismisses or queues folder removal.
    func discard() {
        guard let id = admission.invalidate() else { return }
        enqueueClear(id)
    }
    private func enqueueClear(_ id: UUID) {
        CaptureFiles.queue.async { if self.attempt?.id == id { self.clearAttempt() } }
    }
    private func clearAttempt() {
        guard let a = attempt else { return }
        if let writer = a.writer, writer.status == .writing || writer.status == .unknown { writer.cancelWriting() }
        try? CaptureFiles.remove(a.url)
        attempt = nil
    }
    private func fail(_ id: UUID) {
        guard admission.invalidate(id) != nil else { return }
        emit(id, .failed)
        if attempt?.id == id { clearAttempt() }
    }
    private func emit(_ id: UUID, _ event: Event) { DispatchQueue.main.async { self.onEvent(id, event) } }

    private static func protect(_ url: URL) throws {
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
        #endif
    }

    /// Async property loading supports iOS 15. Readers decode actual samples, rather than approximate thumbnail seeks.
    static func validate(url: URL, takenAt: String) async throws -> CaptureVideo {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard takenAt.hasSuffix("Z"), formatter.date(from: takenAt) != nil,
              url.isFileURL, url.standardizedFileURL.path == url.path, url.resolvingSymlinksInPath().path == url.path else { throw Failure.invalidMedia }
        let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
        guard values.isRegularFile == true, let bytes = values.fileSize, bytes > 0, bytes <= maximumBytes else { throw Failure.invalidMedia }
        let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        let duration = try await asset.load(.duration)
        let tracks = try await asset.load(.tracks)
        guard duration.isNumeric, duration.seconds >= 1, duration.seconds <= maximumDuration, tracks.count == 1,
              tracks[0].mediaType == .video, try await asset.load(.metadata).isEmpty,
              try await asset.load(.commonMetadata).isEmpty else { throw Failure.invalidMedia }
        for format in try await asset.load(.availableMetadataFormats) {
            guard try await asset.loadMetadata(for: format).isEmpty else { throw Failure.invalidMedia }
        }
        let track = tracks[0]
        let size = try await track.load(.naturalSize)
        let transform = try await track.load(.preferredTransform)
        let formats = try await track.load(.formatDescriptions)
        guard size.width >= 2, size.width <= 720, size.height >= size.width, size.height <= 1280,
              size.width.rounded() == size.width, size.height.rounded() == size.height,
              Int(size.width) % 2 == 0, Int(size.height) % 2 == 0, transform == .identity, !formats.isEmpty,
              try await track.load(.metadata).isEmpty else { throw Failure.invalidMedia }
        for format in try await track.load(.availableMetadataFormats) {
            guard try await track.loadMetadata(for: format).isEmpty else { throw Failure.invalidMedia }
        }
        for format in formats {
            let dimensions = CMVideoFormatDescriptionGetDimensions(format)
            guard CMFormatDescriptionGetMediaSubType(format) == kCMVideoCodecType_H264,
                  dimensions.width == Int32(size.width), dimensions.height == Int32(size.height) else { throw Failure.invalidMedia }
        }
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
        output.alwaysCopiesSampleData = false
        guard reader.canAdd(output) else { throw Failure.invalidMedia }
        reader.add(output)
        guard reader.startReading() else { throw Failure.invalidMedia }
        defer { if reader.status == .reading { reader.cancelReading() } }
        var count = 0
        var first: CMTime?
        var last: CMTime?
        var lastEnd = CMTime.zero
        while let sample = output.copyNextSampleBuffer() {
            let pts = CMSampleBufferGetPresentationTimeStamp(sample)
            let span = CMSampleBufferGetDuration(sample)
            guard CMSampleBufferIsValid(sample), CMSampleBufferDataIsReady(sample), let image = CMSampleBufferGetImageBuffer(sample),
                  CVPixelBufferGetWidth(image) == Int(size.width), CVPixelBufferGetHeight(image) == Int(size.height),
                  pts.isNumeric, pts.seconds >= 0, pts.seconds < 30,
                  last.map({ CMTimeSubtract(pts, $0).seconds + 0.000_002 >= frameInterval.seconds }) ?? true else { throw Failure.invalidMedia }
            count += 1
            guard count <= 450 else { throw Failure.invalidMedia }
            first = first ?? pts
            last = pts
            lastEnd = CMTimeAdd(pts, span.isNumeric && span.seconds > 0 ? span : frameInterval)
        }
        guard reader.status == .completed, count >= 2, let first = first, let last = last,
              first.seconds < 0.001, lastEnd.seconds + 0.002 >= duration.seconds,
              last.seconds + frameInterval.seconds + 0.002 >= duration.seconds else { throw Failure.invalidMedia }
        let file = try FileHandle(forReadingFrom: url)
        defer { try? file.close() }
        var hash = SHA256()
        var total = 0
        while let chunk = try file.read(upToCount: 256 * 1024), !chunk.isEmpty {
            total += chunk.count
            guard total <= maximumBytes else { throw Failure.invalidMedia }
            hash.update(data: chunk)
        }
        guard total == bytes else { throw Failure.invalidMedia }
        return CaptureVideo(takenAt: takenAt, width: Int(size.width), height: Int(size.height),
                            durationMs: Int(ceil(duration.seconds * 1000)), byteLength: bytes,
                            sha256: hash.finalize().map { String(format: "%02x", $0) }.joined(), url: url)
    }
}
