import ARKit
import AVFoundation
import Capacitor
import CoreImage
import CryptoKit
import ImageIO
import os.log
import UniformTypeIdentifiers
import UIKit

let captureLog = OSLog(subsystem: "org.fixlist.app", category: "RoomCapture")

#if DEBUG && targetEnvironment(simulator)
/// Explicit, synthetic layout review only. Compiled out of Release and device builds.
enum CaptureUIPreview {
    static var enabled: Bool {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: "-FixListCaptureUIPreview"), index + 1 < args.count else { return false }
        return args[index + 1] == "1"
    }
    /// Optional `-FixListCaptureUIPreviewState N` (0-6) starts the preview at a given state for screenshots.
    static var initialState: Int {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: "-FixListCaptureUIPreviewState"), index + 1 < args.count,
              let value = Int(args[index + 1]), (0..<7).contains(value) else { return 0 }
        return value
    }
}
#endif

struct CapturePrompt {
    let checklistItemId: String?
    let text: String
}

struct CaptureOptions {
    let captureId: String
    let roomId: String
    let roomName: String
    let prompts: [CapturePrompt]
    let strings: [String: String]

    // Keep these keys in exact parity with NATIVE_CAPTURE_STRING_KEYS. Missing or
    // empty translations fall back individually; no native UI text is invented.
    static let english = [
        "stepOutline": "Step 1 of 3 · Outline the floor",
        "stepPhotos": "Step 3 of 3 · Close-up photos",
        "tourStepOutline": "Step 1 of 3 · Outline the floor",
        "tourStepPhotos": "Step 3 of 3 · Close-up photos",
        "stepTour": "Step 2 of 3 · 360° view",
        "tourReady": "Stand in one spot and tap Start. Keep the phone in the same place and step around it as you turn.",
        "tourAim": "Aim at each dot and hold still until it is captured: eye level first, then down toward the floor.",
        "tourProgress": "{count} of 24 · {ring}",
        "tourLevel": "Look around at eye level",
        "tourFloor": "Look down toward the floor",
        "tourStart": "Start",
        "tourFinishSpot": "Finish this spot",
        "tourCancelSpot": "Cancel this spot",
        "tourBuilding": "Building 360° view…",
        "tourSaved": "{count} of 6 spots saved. Add another spot or finish.",
        "tourAnother": "Add another spot",
        "tourWalk": "Walk to the next spot, then tap Start. Keep the phone in place while you turn.",
        "tourCloseups": "Add close-up photos",
        "tourFinish": "Finish",
        "tourReturn": "Return to the starting spot. Turn without walking.",
        "tourFailed": "This 360° view could not be saved. Try this spot again.",
        "tourResetTitle": "Restart room tracking and clear 360° views?",
        "tourResetMessage": "The outline, 360° views and photo positions will be cleared. Close-up photos will be kept.",
        "tourResetNotice": "Room tracking restarted. The old outline, 360° views and photo positions were cleared.",
        "tourCancelMessage": "Stop this scan and delete its 360° views, photos and video?",
        "aimCorner": "Aim the dot at a floor corner, then tap +.",
        "moreCorners": "Add more corners, or tap Done.",
        "closeAtFirst": "Tap + to close the outline.",
        "addCorner": "Add a corner at the centre dot",
        "moreOptions": "More capture options",
        "usePhoto": "Use photo",
        "doorChip": "Door",
        "approximateShort": "Approximate sketch · not a measurement.",
        "previewNextState": "Preview: next state",
        "findFloor": "Point the phone at the floor and move it slowly.",
        "floorFound": "Floor found.",
        "trackingLimited": "Move slowly; point at something with texture.",
        "interrupted": "Room tracking was interrupted. Return to the same place.",
        "relocalizeFailed": "Room tracking restarted. The old outline and photo positions were cleared.",
        "restartTracking": "Restart room tracking",
        "restartConfirmTitle": "Restart room tracking?",
        "restartConfirmMessage": "The outline and photo positions will be cleared. Your photos will be kept.",
        "tapCorners": "Tap each corner of the room on the floor.",
        "cornerCount": "{count} corners",
        "undo": "Undo", "closeOutline": "Close outline", "markDoor": "Mark a door",
        "doorMode": "Tap the floor at a doorway.", "skipOutline": "Skip outline",
        "approximate": "Approximate room sketch. Not to scale for measuring.",
        "photoProgress": "Photo {current} of {total}", "shutter": "Take photo",
        "retake": "Retake", "skip": "Skip", "next": "Next", "done": "Done",
        "cancel": "Cancel", "cancelConfirmTitle": "Stop this walk-through?",
        "cancelConfirmMessage": "The photos from this walk-through will be removed.",
        "cancelConfirmStop": "Stop and remove photos", "cancelConfirmKeep": "Keep going",
        "recordVideo": "Record video",
        "stopVideo": "Stop recording",
        "useVideo": "Use video",
        "retakeVideo": "Retake video",
        "videoRecording": "Recording {seconds} / 30 s",
        "videoReview": "Review video",
        "videoSaved": "Video saved",
        "videoFailed": "The video could not be saved. Try again or take a photo.",
        "videoStopped": "Recording was interrupted. Your saved photos and video are kept.",
        "videoNeedsPhoto": "Take at least one photo to finish the room scan.",
        "videoLimit": "One silent video, up to 30 seconds.",
        "videoCancel": "Stop this scan and delete its photos and video?"
    ]

    #if DEBUG && targetEnvironment(simulator)
    init(uiPreview: Void) {
        captureId = "cap-ui-preview-only"
        roomId = "living-room"
        roomName = "Living room"
        prompts = [
            CapturePrompt(checklistItemId: nil, text: "Take a photo of the room."),
            CapturePrompt(checklistItemId: nil, text: "Photograph the floor and the path through the room."),
            CapturePrompt(checklistItemId: nil, text: "Photograph the doorway."),
            CapturePrompt(checklistItemId: nil, text: "Take one more photo of the room.")
        ]
        strings = Self.english
    }
    #endif

    init?(call: CAPPluginCall) {
        guard let id = call.getString("captureId"), CaptureFiles.validId(id),
              let room = call.getString("roomId"), !room.isEmpty, room.count <= 200,
              let name = call.getString("roomName"), name.count <= 500,
              let language = call.getString("language"), ["en", "es", "zh", "vi", "ko", "tl", "ru", "fr", "ar"].contains(language),
              let rows = call.getArray("prompts"), rows.count <= 40 else { return nil }
        var parsed: [CapturePrompt] = []
        for row in rows {
            guard let row = row as? [String: Any],
                  let text = row["text"] as? String, !text.isEmpty, text.count <= 4_000 else { return nil }
            let item: String?
            if row["checklistItemId"] is NSNull { item = nil }
            else if let value = row["checklistItemId"] as? String, !value.isEmpty, value.count <= 200 { item = value }
            else { return nil } // Missing, numeric and empty IDs are not overview prompts.
            parsed.append(CapturePrompt(checklistItemId: item, text: text))
        }
        let supplied = call.getObject("strings") ?? [:]
        var translated = Self.english
        for key in Self.english.keys {
            if let value = supplied[key] as? String, !value.isEmpty, value.count <= 4_000 {
                translated[key] = value
            }
        }
        captureId = id
        roomId = room
        roomName = name
        prompts = parsed
        strings = translated
    }
}

enum CaptureFiles {
    // All writes and deletes share this queue. A reset queued behind an in-flight
    // JPEG write cannot leave that JPEG resurrected after discardAll resolves.
    static let queue = DispatchQueue(label: "org.fixlist.capture-files", qos: .userInitiated)
    static var root: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("fixlist-captures", isDirectory: true).resolvingSymlinksInPath()
    }
    static func validId(_ id: String) -> Bool {
        id.range(of: "\\Acap-[a-z0-9-]{8,40}\\z", options: .regularExpression) != nil
    }
    static func folder(_ id: String) -> URL { root.appendingPathComponent(id, isDirectory: true) }
    static func remove(_ url: URL) throws {
        do { try FileManager.default.removeItem(at: url) }
        catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileNoSuchFileError { }
    }
    static func timestamp(_ date: Date = Date()) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter.string(from: date)
    }
}

/// Selection is pure so changes in plane estimates can be checked without an
/// AR session. Once a point or posed photo uses a floor, it is a drawing origin.
enum CaptureFloorMath {
    static func select(previous: Float?, heights: [Float], locked: Bool) -> Float? {
        if locked { return previous }
        return heights.min()
    }

    static func candidate(height: Float, cameraY: Float, classification: ARPlaneAnchor.Classification) -> Float? {
        // ARKit's refined .none carries a classification Status; it is not
        // Optional.none. Pattern matching also works before iOS 16, when this
        // SDK enum did not yet provide its Equatable conformance.
        switch classification {
        case .floor, .none(_): break
        default: return nil
        }
        guard height.isFinite, cameraY.isFinite, abs(height) <= 50, height < cameraY else { return nil }
        return height
    }

    /// Extend the selected approximate floor, rather than whichever detected
    /// plane happens to answer a later raycast (or no longer exists after merge).
    static func intersection(origin: SIMD3<Float>, direction: SIMD3<Float>, floorY: Float) -> SIMD2<Float>? {
        guard origin.x.isFinite, origin.y.isFinite, origin.z.isFinite,
              direction.x.isFinite, direction.y.isFinite, direction.z.isFinite,
              floorY.isFinite else { return nil }
        let length = simd_length(direction)
        guard length > 0.0001 else { return nil }
        let ray = direction / length
        guard ray.y < -0.0001, origin.y > floorY else { return nil }
        let distance = (floorY - origin.y) / ray.y
        guard distance >= 0.05, distance <= 15 else { return nil }
        let hit = origin + ray * distance
        guard hit.x.isFinite, hit.z.isFinite, abs(hit.x) <= 50, abs(hit.z) <= 50 else { return nil }
        return SIMD2(hit.x, hit.z)
    }
}

/// Fit the actual ARView, so its camera background AND projected geometry share
/// the full portrait image. ARKit's native sensor resolution is landscape.
enum CaptureViewportMath {
    static func portraitFrame(in bounds: CGRect, imageResolution: CGSize) -> CGRect? {
        guard bounds.origin.x.isFinite, bounds.origin.y.isFinite,
              bounds.width.isFinite, bounds.height.isFinite, bounds.width > 0, bounds.height > 0,
              imageResolution.width.isFinite, imageResolution.height.isFinite,
              imageResolution.width > 0, imageResolution.height > 0 else { return nil }
        let scale = min(bounds.width / imageResolution.height, bounds.height / imageResolution.width)
        let size = CGSize(width: imageResolution.height * scale, height: imageResolution.width * scale)
        guard size.width.isFinite, size.height.isFinite, size.width > 0, size.height > 0 else { return nil }
        return CGRect(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2,
                      width: size.width, height: size.height)
    }
}

/// Pure portrait geometry, independent of ARSession and rendering. The sensor
/// has +X image-right, +Y image-up, -Z forward. A clockwise pixel rotation is
/// (u',v') = (H-v,u) in edge coordinates (pixel centres are n+0.5).
/// Thus upright camera +X is sensor +Y, upright +Y is sensor -X, and Z is
/// unchanged: cameraToWorld' = cameraToWorld * Rz(+pi/2), determinant +1.
enum CapturePortraitMath {
    struct Geometry {
        let width: Int
        let height: Int
        let transform: simd_float4x4
        let intrinsics: [Double]
        var flatTransform: [Double] {
            (0..<4).flatMap { c in (0..<4).map { r in Double(transform[c][r]) } }
        }
        func project(_ world: SIMD3<Float>) -> CGPoint? {
            let p = transform.inverse * SIMD4<Float>(world.x, world.y, world.z, 1)
            guard p.z < 0 else { return nil }
            return CGPoint(x: intrinsics[2] + intrinsics[0] * Double(p.x / -p.z),
                           y: intrinsics[3] - intrinsics[1] * Double(p.y / -p.z))
        }
    }

    static func make(width: Int, height: Int, intrinsics k: simd_float3x3,
                     cameraToWorld: simd_float4x4, maxDimension: Int = 1600) -> Geometry? {
        guard width > 0, height > 0, maxDimension > 0 else { return nil }
        let scale = min(1, Double(maxDimension) / Double(max(width, height)))
        let outputWidth = max(1, Int((Double(height) * scale).rounded()))
        let outputHeight = max(1, Int((Double(width) * scale).rounded()))
        let sx = Double(outputWidth) / Double(height)
        let sy = Double(outputHeight) / Double(width)
        // ARCamera K's origin is the CENTRE of its upper-left sensor pixel
        // (ARCamera.h). Add 0.5 before rotating to the contract's edge origin.
        // Clockwise rotation swaps focal lengths and maps the principal point.
        let outputK = [Double(k[1][1]) * sx, Double(k[0][0]) * sy,
                       (Double(height) - Double(k[2][1]) - 0.5) * sx,
                       (Double(k[2][0]) + 0.5) * sy]
        let rotate = simd_float4x4(columns: (SIMD4(0, 1, 0, 0), SIMD4(-1, 0, 0, 0),
                                                     SIMD4(0, 0, 1, 0), SIMD4(0, 0, 0, 1)))
        let result = Geometry(width: outputWidth, height: outputHeight,
                              transform: cameraToWorld * rotate, intrinsics: outputK)
        let r = simd_float3x3(columns: (result.transform[0].xyz, result.transform[1].xyz, result.transform[2].xyz))
        guard result.flatTransform.allSatisfy(\.isFinite), outputK.allSatisfy(\.isFinite),
              outputK[0] > 0, outputK[1] > 0,
              outputK[2] > 0, outputK[2] < Double(outputWidth),
              outputK[3] > 0, outputK[3] < Double(outputHeight),
              abs(simd_determinant(r) - 1) < 0.001,
              (0..<3).allSatisfy({ i in (0..<3).allSatisfy { j in
                  abs(simd_dot(r[i], r[j]) - (i == j ? 1 : 0)) < 0.001
              } }), result.transform[0].w == 0, result.transform[1].w == 0,
              result.transform[2].w == 0, result.transform[3].w == 1 else { return nil }
        return result
    }

    #if DEBUG
    static func selfTest() {
        let k = simd_float3x3(columns: (SIMD3(1200, 0, 0), SIMD3(0, 1180, 0), SIMD3(951, 533, 1)))
        var sensor = matrix_identity_float4x4
        sensor[3] = SIMD4(2, -1, 3, 1)
        var passed = true
        var checks = 0
        for size in [(1920, 1080), (1921, 1081), (1280, 720)] {
            guard let g = make(width: size.0, height: size.1, intrinsics: k, cameraToWorld: sensor) else {
                passed = false; continue
            }
            let sx = Double(g.width) / Double(size.1), sy = Double(g.height) / Double(size.0)
            for p in [SIMD3<Float>(0, 0, -1), SIMD3(0.2, -0.15, -1), SIMD3(-0.3, 0.1, -2)] {
                let world = (sensor * SIMD4(p.x, p.y, p.z, 1)).xyz
                let expected = CGPoint(x: (Double(size.1) - (533.5 - 1180 * Double(p.y / -p.z))) * sx,
                                       y: (951.5 + 1200 * Double(p.x / -p.z)) * sy)
                guard let actual = g.project(world) else { passed = false; continue }
                passed = passed && hypot(actual.x - expected.x, actual.y - expected.y) < 0.001
                checks += 1
            }
            passed = passed && g.width <= 1600 && g.height <= 1600
                && simd_distance(g.transform[0].xyz, sensor[1].xyz) < 0.0001
                && simd_distance(g.transform[1].xyz, -sensor[0].xyz) < 0.0001
        }
        passed = passed && make(width: 0, height: 1080, intrinsics: k, cameraToWorld: sensor) == nil
        os_log("FixListCapture portrait math self-test: %{public}@ (%d projections, resize, axes, invalid input)",
               log: captureLog, type: passed ? .default : .fault, passed ? "PASS" : "FAIL", checks)
        assert(passed, "Portrait capture geometry self-test failed")
    }

    static func check(camera: ARCamera, geometry: Geometry, sensorWidth: Int, sensorHeight: Int) -> Bool {
        let viewport = CGSize(width: geometry.width, height: geometry.height)
        let sx = Double(geometry.width) / Double(sensorHeight)
        let sy = Double(geometry.height) / Double(sensorWidth)
        // projectPoint is aspect-FILL, whereas the saved JPEG keeps the full
        // sensor. Undo its tiny crop caused by integer resize rounding before
        // comparing with our independently scaled full-image coordinates.
        let fill = max(sx, sy)
        let ox = (Double(geometry.width) - Double(sensorHeight) * fill) / 2
        let oy = (Double(geometry.height) - Double(sensorWidth) * fill) / 2
        var passed = true
        for p in [SIMD4<Float>(0, 0, -1, 1), SIMD4(0.18, 0.12, -1, 1)] {
            let world = (geometry.transform * p).xyz
            let apple = camera.projectPoint(world, orientation: .portrait, viewportSize: viewport)
            let uncropped = CGPoint(x: (apple.x - ox) / fill * sx, y: (apple.y - oy) / fill * sy)
            guard let ours = geometry.project(world) else { return false }
            let error = hypot(ours.x - uncropped.x, ours.y - uncropped.y)
            if !error.isFinite || error > 2 {
                os_log("FixListCapture portrait projection disagreement: %.3f px", log: captureLog, type: .error, error)
                passed = false
            }
        }
        return passed
    }
    #endif
}

extension SIMD4 where Scalar == Float {
    var xyz: SIMD3<Float> { SIMD3(x, y, z) }
}

struct CapturePhoto {
    let photoId: String
    let checklistItemId: String?
    let takenAt: String
    let width: Int
    let height: Int
    let sha256: String
    var camera: [String: Any]?
    let url: URL
    var json: [String: Any] {
        ["photoId": photoId, "checklistItemId": checklistItemId as Any? ?? NSNull(),
         "takenAt": takenAt, "width": width, "height": height, "sha256": sha256,
         "camera": camera as Any? ?? NSNull()]
    }
}

/// CGImage carries pixels, not the source photo's metadata. ImageIO receives only
/// our JPEG quality setting, yet it always writes a minimal Exif IFD holding the
/// pixel dimensions (verified with iOS/macOS 26 ImageIO). Those fields describe
/// only the image itself, so they are the one Exif content allowed.
enum CaptureJPEG {
    enum Failure: Error { case jpeg, metadata }
    static let allowedExif: Set<String> = [kCGImagePropertyExifPixelXDimension as String,
                                           kCGImagePropertyExifPixelYDimension as String,
                                           kCGImagePropertyExifColorSpace as String]

    static func encode(_ image: CGImage) throws -> Data {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil)
        else { throw Failure.jpeg }
        CGImageDestinationSetProperties(destination, [:] as CFDictionary)
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw Failure.jpeg }
        let bytes = data as Data
        guard let source = CGImageSourceCreateWithData(bytes as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              isPrivate(properties) else { throw Failure.metadata }
        return bytes
    }

    static func isPrivate(_ properties: [CFString: Any]) -> Bool {
        guard properties[kCGImagePropertyGPSDictionary] == nil,
              properties[kCGImagePropertyTIFFDictionary] == nil,
              properties[kCGImagePropertyExifAuxDictionary] == nil else { return false }
        guard let exif = properties[kCGImagePropertyExifDictionary] else { return true }
        guard let fields = exif as? [String: Any] else { return false }
        return Set(fields.keys).isSubset(of: allowedExif)
    }
}

enum CapturePhotoWriter {
    enum Failure: Error { case geometry, rendering }
    // Called only on CaptureFiles.queue.
    static func write(frame: ARFrame, options: CaptureOptions, photoId: String,
                      checklistItemId: String?, takenAt: String) throws -> (CapturePhoto, Data) {
        let buffer = frame.capturedImage
        let w = CVPixelBufferGetWidth(buffer), h = CVPixelBufferGetHeight(buffer)
        guard let geometry = CapturePortraitMath.make(width: w, height: h, intrinsics: frame.camera.intrinsics,
                                                       cameraToWorld: frame.camera.transform) else { throw Failure.geometry }
        #if DEBUG
        guard CapturePortraitMath.check(camera: frame.camera, geometry: geometry, sensorWidth: w, sensorHeight: h)
        else { throw Failure.geometry }
        #endif
        let upright = CIImage(cvPixelBuffer: buffer).oriented(.right)
        let resized = upright.transformed(by: CGAffineTransform(scaleX: CGFloat(geometry.width) / upright.extent.width,
                                                               y: CGFloat(geometry.height) / upright.extent.height))
        let rect = CGRect(x: 0, y: 0, width: geometry.width, height: geometry.height)
        guard let image = CIContext().createCGImage(resized, from: rect) else { throw Failure.rendering }
        let bytes = try CaptureJPEG.encode(image)
        let url = CaptureFiles.folder(options.captureId).appendingPathComponent(photoId + ".jpg")
        try bytes.write(to: url, options: [.atomic, .completeFileProtection])
        let camera: [String: Any] = ["transform": geometry.flatTransform, "intrinsics": geometry.intrinsics, "tracking": "normal"]
        return (CapturePhoto(photoId: photoId, checklistItemId: checklistItemId, takenAt: takenAt,
                             width: geometry.width, height: geometry.height,
                             sha256: SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(),
                             camera: camera, url: url), bytes)
    }
}

/// Shared pure geometry. Equirect pixels use edge coordinates; callers pass
/// pixel centres (u + 0.5, v + 0.5). Camera translation never affects rays.
enum CaptureTourMath {
    static func direction(x: Float, y: Float, width: Int, height: Int) -> SIMD3<Float> {
        let longitude = (x / Float(width) - 0.5) * 2 * Float.pi
        let latitude = (0.5 - y / Float(height)) * Float.pi
        return SIMD3(sin(longitude) * cos(latitude), sin(latitude), -cos(longitude) * cos(latitude))
    }
    static func pixel(_ d: SIMD3<Float>, width: Int, height: Int) -> SIMD2<Float> {
        let n = simd_normalize(d)
        var u = (atan2(n.x, -n.z) / (2 * Float.pi) + 0.5) * Float(width)
        if u >= Float(width) { u = 0 }
        return SIMD2(u, (0.5 - asin(max(-1, min(1, n.y))) / Float.pi) * Float(height))
    }
    static func ray(x: Float, y: Float, geometry g: CapturePortraitMath.Geometry) -> SIMD3<Float> {
        let p = SIMD3((x - Float(g.intrinsics[2])) / Float(g.intrinsics[0]),
                      (Float(g.intrinsics[3]) - y) / Float(g.intrinsics[1]), -1)
        return simd_normalize(g.transform[0].xyz * p.x + g.transform[1].xyz * p.y + g.transform[2].xyz * p.z)
    }
    static func project(_ d: SIMD3<Float>, geometry g: CapturePortraitMath.Geometry) -> SIMD2<Float>? {
        let z = -simd_dot(g.transform[2].xyz, d)
        guard z > 0.0001 else { return nil }
        return SIMD2(Float(g.intrinsics[2]) + Float(g.intrinsics[0]) * simd_dot(g.transform[0].xyz, d) / z,
                     Float(g.intrinsics[3]) - Float(g.intrinsics[1]) * simd_dot(g.transform[1].xyz, d) / z)
    }
    static func targets(yaw: Float) -> [SIMD3<Float>] {
        [Float(0), -.pi / 4].flatMap { pitch in
            (0..<12).map { index in
                let angle = yaw + Float(index) * .pi / 6
                return SIMD3(sin(angle) * cos(pitch), sin(pitch), -cos(angle) * cos(pitch))
            }
        }
    }
    static func angularVelocity(previous: simd_float4x4, current: simd_float4x4, elapsed: TimeInterval) -> Float {
        guard elapsed > 0, elapsed < 0.25 else { return .infinity }
        let a = simd_quatf(simd_float3x3(columns: (previous[0].xyz, previous[1].xyz, previous[2].xyz)))
        let b = simd_quatf(simd_float3x3(columns: (current[0].xyz, current[1].xyz, current[2].xyz)))
        return 2 * acos(min(1, abs(simd_dot(a.vector, b.vector)))) / Float(elapsed)
    }
    static func select(forward: SIMD3<Float>, targets: [SIMD3<Float>], captured: Set<Int>,
                       trackingNormal: Bool, angularVelocity: Float) -> Int? {
        // About 6°/s: indoor exposures smear frames captured while still turning.
        guard trackingNormal, angularVelocity.isFinite, angularVelocity <= 0.10 else { return nil }
        var best = cos(Float.pi / 36) // five degrees
        var result: Int?
        for i in targets.indices where !captured.contains(i) {
            let dot = simd_dot(forward, targets[i])
            if dot >= best { best = dot; result = i }
        }
        return result
    }
    static func canFinish(_ count: Int) -> Bool { count >= 15 && count <= 24 }
    static func nearOrigin(_ position: SIMD3<Float>, origin: SIMD3<Float>) -> Bool {
        // Turning in place naturally moves a hand-held camera around the body.
        // Allow that small circle while rejecting walking to a different spot.
        simd_distance(position, origin) <= 0.65
    }
}

final class CaptureTourCancellation {
    private let lock = NSLock()
    private var stopped = false
    func cancel() { lock.lock(); stopped = true; lock.unlock() }
    var isCancelled: Bool { lock.lock(); defer { lock.unlock() }; return stopped }
}

struct CaptureTourStop {
    let stopId: String
    let position: SIMD3<Float>
    let capturedAt: String
    let width: Int
    let height: Int
    let sha256: String
    let coverage: Double
    let url: URL
    var fileId: String { "pano-" + stopId }
    var json: [String: Any] {
        ["stopId": stopId, "position": [Double(position.x), Double(position.y), Double(position.z)],
         "capturedAt": capturedAt,
         "panorama": ["fileId": fileId, "width": width, "height": height, "sha256": sha256, "coverage": coverage]]
    }
}

/// Bounded upright sRGB rasters, never retained ARFrames/CVPixelBuffers.
/// 24 x 1080 x 1440 x 4 is 142 MiB; one pending conversion and one 32 MiB output.
struct CaptureTourFrame {
    let geometry: CapturePortraitMath.Geometry
    let pixels: Data // top row first, RGBA8, alpha ignored
}

enum CaptureTourStitcher {
    enum Failure: Error { case rendering, cancelled, empty }
    struct Result {
        let image: CGImage
        let coverage: Double
        let seconds: Double
    }
    private struct Prepared {
        let right: SIMD3<Float>
        let up: SIMD3<Float>
        let forward: SIMD3<Float>
        let fx: Float, fy: Float, cx: Float, cy: Float
        let width: Int, height: Int
        let halfAngle: Float
        init(_ frame: CaptureTourFrame) {
            let g = frame.geometry
            right = g.transform[0].xyz; up = g.transform[1].xyz; forward = -g.transform[2].xyz
            fx = Float(g.intrinsics[0]); fy = Float(g.intrinsics[1])
            cx = Float(g.intrinsics[2]); cy = Float(g.intrinsics[3])
            width = g.width; height = g.height
            let dx = max(cx, Float(width) - cx) / fx
            let dy = max(cy, Float(height) - cy) / fy
            halfAngle = atan(sqrt(dx * dx + dy * dy))
        }
        func projection(_ d: SIMD3<Float>) -> SIMD3<Float>? {
            let z = simd_dot(forward, d)
            guard z > 0.001 else { return nil }
            let x = cx + fx * simd_dot(right, d) / z
            let y = cy - fy * simd_dot(up, d) / z
            guard x >= 0.5, y >= 0.5, x < Float(width) - 0.5, y < Float(height) - 0.5 else { return nil }
            let edge = min(min(x, Float(width) - x) / Float(width), min(y, Float(height) - y) / Float(height))
            return SIMD3(x, y, min(1, edge * 8) * z * z)
        }
    }
    private static func sample(_ p: UnsafePointer<UInt8>, width: Int, x: Float, y: Float) -> SIMD3<Float> {
        let xx = x - 0.5, yy = y - 0.5
        let ix = Int(xx), iy = Int(yy), ax = xx - Float(ix), ay = yy - Float(iy)
        let offset = (iy * width + ix) * 4
        func color(_ i: Int) -> SIMD3<Float> { SIMD3(Float(p[i]), Float(p[i + 1]), Float(p[i + 2])) }
        return simd_mix(simd_mix(color(offset), color(offset + 4), SIMD3(repeating: ax)),
                        simd_mix(color(offset + width * 4), color(offset + width * 4 + 4), SIMD3(repeating: ax)), SIMD3(repeating: ay))
    }
    // All Data pointer scopes stay alive until concurrentPerform returns.
    private static func withPixels<T>(_ frames: [CaptureTourFrame], index: Int = 0,
                                      pointers: [UnsafePointer<UInt8>] = [], body: ([UnsafePointer<UInt8>]) throws -> T) rethrows -> T {
        if index == frames.count { return try body(pointers) }
        return try frames[index].pixels.withUnsafeBytes { bytes in
            try withPixels(frames, index: index + 1, pointers: pointers + [bytes.bindMemory(to: UInt8.self).baseAddress!], body: body)
        }
    }
    /// Estimate exposure only from common rays, so a dark floor does not get
    /// normalized to a bright wall. Robust pairwise log ratios, clamped gains.
    private static func gains(_ frames: [Prepared], pixels: [UnsafePointer<UInt8>]) -> [Float] {
        var edges: [(Int, Int, Float)] = []
        for i in frames.indices {
            for j in frames.indices where j > i && simd_dot(frames[i].forward, frames[j].forward) > 0.25 {
                var ratios: [Float] = []
                for y in 0..<7 { for x in 0..<7 {
                    let a = frames[i]
                    let u = (Float(x) + 1) / 8 * Float(a.width)
                    let v = (Float(y) + 1) / 8 * Float(a.height)
                    let d = simd_normalize(a.right * ((u - a.cx) / a.fx) + a.up * ((a.cy - v) / a.fy) + a.forward)
                    guard let b = frames[j].projection(d), b.z > 0.15 else { continue }
                    let ca = sample(pixels[i], width: a.width, x: u, y: v)
                    let cb = sample(pixels[j], width: frames[j].width, x: b.x, y: b.y)
                    let la = simd_dot(ca, SIMD3(0.2126, 0.7152, 0.0722))
                    let lb = simd_dot(cb, SIMD3(0.2126, 0.7152, 0.0722))
                    if la > 20, lb > 20, la < 235, lb < 235 { ratios.append(log(lb / la)) }
                } }
                if ratios.count >= 6 { ratios.sort(); edges.append((i, j, ratios[ratios.count / 2])) }
            }
        }
        var logs = [Float](repeating: 0, count: frames.count)
        for _ in 0..<16 {
            var sums = [Float](repeating: 0, count: frames.count), counts = sums
            for (i, j, delta) in edges {
                sums[i] += logs[j] + delta; counts[i] += 1
                sums[j] += logs[i] - delta; counts[j] += 1
            }
            let next = frames.indices.map { counts[$0] > 0 ? (logs[$0] + sums[$0] / counts[$0]) * 0.5 : 0 }
            let mean = next.reduce(0, +) / Float(max(1, next.count))
            logs = next.map { max(-0.22, min(0.22, $0 - mean)) }
        }
        return logs.map { exp($0) }
    }
    static func stitch(_ frames: [CaptureTourFrame], width: Int = 4096, height: Int = 2048,
                       cancellation: CaptureTourCancellation = CaptureTourCancellation()) throws -> Result {
        guard !frames.isEmpty, frames.count <= 24, width > 0, height > 0,
              width <= 4096, height <= 2048,
              frames.allSatisfy({ $0.geometry.width >= 2 && $0.geometry.height >= 2 &&
                  $0.pixels.count == $0.geometry.width * $0.geometry.height * 4 }) else { throw Failure.empty }
        let start = ProcessInfo.processInfo.systemUptime
        let prepared = frames.map(Prepared.init)
        let output = UnsafeMutablePointer<UInt8>.allocate(capacity: width * height * 4)
        output.initialize(repeating: 128, count: width * height * 4)
        defer { output.deallocate() }
        let covered = UnsafeMutablePointer<Int>.allocate(capacity: height)
        covered.initialize(repeating: 0, count: height)
        defer { covered.deallocate() }
        let longitudes = (0..<width).map { (Float($0) + 0.5) / Float(width) * 2 * Float.pi - Float.pi }
        let sins = longitudes.map { sin($0) }, coses = longitudes.map { cos($0) }
        withPixels(frames) { pixels in
            let gain = gains(prepared, pixels: pixels)
            DispatchQueue.concurrentPerform(iterations: height) { row in
                if cancellation.isCancelled { return }
                let latitude = (0.5 - (Float(row) + 0.5) / Float(height)) * Float.pi
                let sy = sin(latitude), cy = cos(latitude)
                // Pre-cull each row, then each 64-pixel longitude tile by each
                // frame's diagonal field of view. Typically 2–5 candidates/pixel.
                let rowFrames = prepared.indices.filter { i in
                    let f = prepared[i].forward
                    return sqrt(f.x * f.x + f.z * f.z) * cy + f.y * sy >= cos(prepared[i].halfAngle)
                }
                var count = 0
                for tile in stride(from: 0, to: width, by: 64) {
                    let end = min(width, tile + 64), centre = (tile + end - 1) / 2
                    let middle = SIMD3(sins[centre] * cy, sy, -coses[centre] * cy)
                    let margin = Float(end - tile) / Float(width) * Float.pi
                    let candidates = rowFrames.filter { simd_dot(prepared[$0].forward, middle) >= cos(prepared[$0].halfAngle + margin) }
                    for column in tile..<end {
                        let d = SIMD3(sins[column] * cy, sy, -coses[column] * cy)
                        var best = SIMD3<Float>(repeating: -1)
                        var indices = SIMD3<Int>(repeating: 0)
                        var px = SIMD3<Float>.zero, py = SIMD3<Float>.zero
                        for i in candidates {
                            guard let p = prepared[i].projection(d) else { continue }
                            if p.z > best.z {
                                var slot = 2
                                if p.z > best.y { slot = 1 }
                                if p.z > best.x { slot = 0 }
                                if slot < 2 { for k in stride(from: 2, through: slot + 1, by: -1) {
                                    best[k] = best[k - 1]; indices[k] = indices[k - 1]; px[k] = px[k - 1]; py[k] = py[k - 1]
                                } }
                                best[slot] = p.z; indices[slot] = i; px[slot] = p.x; py[slot] = p.y
                            }
                        }
                        guard best.x > 0 else { continue }
                        // The best-centred frame owns each pixel; blend with the runner-up
                        // only in a narrow band where both are nearly equal (its seam).
                        // Hand-held spins are not pure rotations, so averaging more
                        // frames everywhere ghosts and blurs edges.
                        let first = indices.x
                        var color = sample(pixels[first], width: prepared[first].width, x: px.x, y: py.x) * gain[first]
                        if best.y > 0 {
                            let t = max(0, min(1, (best.y / best.x - 0.6) / 0.4))
                            let share = 0.5 * t * t * (3 - 2 * t)
                            if share > 0 {
                                let second = indices.y
                                color = color * (1 - share)
                                    + sample(pixels[second], width: prepared[second].width, x: px.y, y: py.y) * (gain[second] * share)
                            }
                        }
                        let offset = (row * width + column) * 4
                        for channel in 0..<3 { output[offset + channel] = UInt8(max(0, min(255, color[channel].rounded()))) }
                        output[offset + 3] = 255
                        count += 1
                    }
                }
                covered[row] = count
            }
        }
        guard !cancellation.isCancelled else { throw Failure.cancelled }
        let data = Data(bytes: output, count: width * height * 4)
        guard let provider = CGDataProvider(data: data as CFData),
              let image = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
                                  bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
                                  provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent) else { throw Failure.rendering }
        let count = (0..<height).reduce(0) { $0 + covered[$1] }
        return Result(image: image, coverage: Double(count) / Double(width * height),
                      seconds: ProcessInfo.processInfo.systemUptime - start)
    }
}

enum CaptureTourRaster {
    static func rgba(_ image: CGImage) throws -> Data {
        var data = Data(count: image.width * image.height * 4)
        let ok = data.withUnsafeMutableBytes { bytes -> Bool in
            guard let cg = CGContext(data: bytes.baseAddress, width: image.width, height: image.height,
                bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }
            cg.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
            return true
        }
        guard ok else { throw CaptureTourStitcher.Failure.rendering }
        return data
    }
}

/// iOS boundary: immediately downscale the one reserved frame, then release it.
enum CaptureTourWriter {
    private static let context = CIContext(options: [.cacheIntermediates: false])
    static func compact(frame: ARFrame) throws -> CaptureTourFrame {
        let buffer = frame.capturedImage
        guard let geometry = CapturePortraitMath.make(width: CVPixelBufferGetWidth(buffer), height: CVPixelBufferGetHeight(buffer),
            intrinsics: frame.camera.intrinsics, cameraToWorld: frame.camera.transform, maxDimension: 1440) else {
            throw CaptureTourStitcher.Failure.rendering
        }
        let upright = CIImage(cvPixelBuffer: buffer).oriented(.right)
        let resized = upright.transformed(by: CGAffineTransform(scaleX: CGFloat(geometry.width) / upright.extent.width,
                                                               y: CGFloat(geometry.height) / upright.extent.height))
        let rect = CGRect(x: 0, y: 0, width: geometry.width, height: geometry.height)
        guard let image = context.createCGImage(resized, from: rect) else { throw CaptureTourStitcher.Failure.rendering }
        return CaptureTourFrame(geometry: geometry, pixels: try CaptureTourRaster.rgba(image))
    }
    static func write(frames: [CaptureTourFrame], captureId: String, stopId: String, position: SIMD3<Float>,
                      capturedAt: String, cancellation: CaptureTourCancellation) throws -> CaptureTourStop {
        let result = try CaptureTourStitcher.stitch(frames, cancellation: cancellation)
        let bytes = try CaptureJPEG.encode(result.image)
        guard !cancellation.isCancelled else { throw CaptureTourStitcher.Failure.cancelled }
        let url = CaptureFiles.folder(captureId).appendingPathComponent("pano-" + stopId + ".jpg")
        try bytes.write(to: url, options: [.atomic, .completeFileProtection])
        os_log("FixListCapture panorama: %.3f s, coverage %.3f", log: captureLog, type: .info, result.seconds, result.coverage)
        return CaptureTourStop(stopId: stopId, position: position, capturedAt: capturedAt, width: 4096, height: 2048,
            sha256: SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(), coverage: result.coverage, url: url)
    }
}

@objc(FixListCapturePlugin)
public class FixListCapturePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FixListCapturePlugin"
    public let jsName = "FixListCapture"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "discardAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "shareFile", returnType: CAPPluginReturnPromise)
    ]
    private var pendingCall: CAPPluginCall?
    private var pendingId: String?
    private var activeCapture: FixListCaptureViewController?
    private var sharing = false

    override public func load() {
        #if DEBUG
        CapturePortraitMath.selfTest()
        #endif
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.presentUIPreview() }
        }
        // Opt-in integration probe for a Simulator with no WebKit inspector.
        // It invokes the actual JS bridge, never native methods directly. It
        // shares only synthetic text and waits for the tester to dismiss the
        // system sheet. This code is absent from device and Release builds.
        if ProcessInfo.processInfo.arguments.contains("--fixlist-capture-smoke-test") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.runSimulatorBridgeProbe() }
        }
        #endif
    }

    #if DEBUG && targetEnvironment(simulator)
    private func presentUIPreview(attempt: Int = 0) {
        // Give the launch window time to appear; never interrupt another sheet.
        guard CaptureUIPreview.enabled, let presenter = bridge?.viewController else { return }
        guard presenter.viewIfLoaded?.window != nil else {
            if attempt < 20 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in self?.presentUIPreview(attempt: attempt + 1) }
            }
            return
        }
        guard presenter.presentedViewController == nil, activeCapture == nil else { return }
        let controller = FixListCaptureViewController(options: CaptureOptions(uiPreview: ())) { [weak self] _ in
            self?.activeCapture = nil
        }
        activeCapture = controller
        presenter.present(controller, animated: true)
    }

    private func runSimulatorBridgeProbe() {
        let script = """
        for (let attempt = 0; attempt < 50 && !window.Capacitor?.Plugins?.FixListCapture; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        const plugin = Capacitor.Plugins.FixListCapture;
        const availability = await plugin.availability();
        const options = {captureId:'cap-simulator-smoke',roomId:'living-room',roomName:'Synthetic room',
          language:'en',prompts:[{checklistItemId:null,text:'Room overview'},
            {checklistItemId:'rug-check',text:'Photograph the floor and rug'}],strings:{}};
        const start = await plugin.start(options);
        if (start.status !== 'unavailable') throw new Error('Realistic overview/checklist input rejected: '+JSON.stringify(start));
        const invalid = [];
        for (const row of [{text:'Missing ID'},{checklistItemId:3,text:'Numeric ID'},{checklistItemId:'',text:'Empty ID'}]) {
          const outcome = await plugin.start({...options,prompts:[row]});
          if (outcome.status !== 'failed' || outcome.reason !== 'invalid-options') throw new Error('Invalid row accepted');
          invalid.push(outcome);
        }
        await plugin.discard({captureId:'cap-simulator-smoke'});
        await plugin.discard({captureId:'cap-simulator-smoke'});
        return JSON.stringify({availability,start,invalid,discard:'idempotent'});
        """
        bridge?.webView?.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { [weak self] result in
            switch result {
            case .success(let value):
                os_log("FixListCapture JS bridge probe: %{public}@", log: captureLog, type: .default, String(describing: value))
                self?.bridge?.webView?.callAsyncJavaScript("""
                return JSON.stringify(await Capacitor.Plugins.FixListCapture.shareFile({
                  fileName:'fixlist-native-smoke.txt',text:'Synthetic FixList native bridge smoke test.'}));
                """, arguments: [:], in: nil, in: .page) { shared in
                    os_log("FixListCapture JS share probe: %{public}@", log: captureLog, type: .default, String(describing: shared))
                }
            case .failure(let error):
                os_log("FixListCapture JS bridge probe failed: %{public}@", log: captureLog, type: .error, error.localizedDescription)
            }
        }
    }
    #endif

    @objc func availability(_ call: CAPPluginCall) {
        let permission: String
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: permission = "authorized"
        case .denied: permission = "denied"
        case .restricted: permission = "restricted"
        case .notDetermined: permission = "not-determined"
        @unknown default: permission = "restricted"
        }
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled { call.resolve(["arkit": true, "camera": permission]); return }
        #endif
        call.resolve(["arkit": ARWorldTrackingConfiguration.isSupported, "camera": permission])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let options = CaptureOptions(call: call) else {
            call.resolve(["status": "failed", "reason": "invalid-options"]); return
        }
        DispatchQueue.main.async {
            guard self.pendingCall == nil, !self.sharing else {
                call.resolve(["status": "failed", "reason": "capture-busy"]); return
            }
            #if DEBUG && targetEnvironment(simulator)
            if CaptureUIPreview.enabled {
                guard let presenter = self.bridge?.viewController, presenter.presentedViewController == nil,
                      presenter.viewIfLoaded?.window != nil else {
                    call.resolve(["status": "failed", "reason": "capture-view-unavailable"]); return
                }
                self.pendingCall = call
                self.pendingId = options.captureId
                let controller = FixListCaptureViewController(options: options) { [weak self] outcome in
                    self?.resolveStart(call, outcome: outcome)
                }
                self.activeCapture = controller
                presenter.present(controller, animated: true)
                return
            }
            #endif
            guard ARWorldTrackingConfiguration.isSupported else { call.resolve(["status": "unavailable"]); return }
            self.pendingCall = call
            self.pendingId = options.captureId
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized: self.presentCapture(options, call: call)
            case .denied, .restricted: self.resolveStart(call, outcome: ["status": "denied"])
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { granted in
                    DispatchQueue.main.async {
                        guard self.pendingCall === call else { return }
                        if granted { self.presentCapture(options, call: call) }
                        else { self.resolveStart(call, outcome: ["status": "denied"]) }
                    }
                }
            @unknown default: self.resolveStart(call, outcome: ["status": "denied"])
            }
        }
    }

    private func resolveStart(_ call: CAPPluginCall, outcome: [String: Any]) {
        guard pendingCall === call else { return }
        pendingCall = nil
        pendingId = nil
        activeCapture = nil
        call.resolve(outcome)
    }

    private func presentCapture(_ options: CaptureOptions, call: CAPPluginCall) {
        guard pendingCall === call else { return }
        guard let presenter = bridge?.viewController, presenter.presentedViewController == nil,
              presenter.viewIfLoaded?.window != nil else {
            resolveStart(call, outcome: ["status": "failed", "reason": "capture-view-unavailable"]); return
        }
        CaptureFiles.queue.async {
            do {
                let folder = CaptureFiles.folder(options.captureId)
                // Never overwrite another completed capture under a reused id.
                guard !FileManager.default.fileExists(atPath: folder.path) else {
                    DispatchQueue.main.async { self.resolveStart(call, outcome: ["status": "failed", "reason": "capture-id-exists"]) }
                    return
                }
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
                                                        attributes: [.protectionKey: FileProtectionType.complete])
                DispatchQueue.main.async {
                    guard self.pendingCall === call else {
                        CaptureFiles.queue.async { try? CaptureFiles.remove(folder) }
                        return
                    }
                    guard presenter.presentedViewController == nil, presenter.viewIfLoaded?.window != nil else {
                        CaptureFiles.queue.async { try? CaptureFiles.remove(folder) }
                        self.resolveStart(call, outcome: ["status": "failed", "reason": "capture-view-unavailable"])
                        return
                    }
                    let controller = FixListCaptureViewController(options: options) { [weak self] outcome in
                        self?.resolveStart(call, outcome: outcome)
                    }
                    self.activeCapture = controller
                    presenter.present(controller, animated: true)
                }
            } catch {
                DispatchQueue.main.async { self.resolveStart(call, outcome: ["status": "failed", "reason": "capture-storage-failed"]) }
            }
        }
    }

    @objc func discard(_ call: CAPPluginCall) {
        guard let id = call.getString("captureId"), CaptureFiles.validId(id) else { call.reject("Invalid captureId."); return }
        discard(call, id: id)
    }

    @objc func discardAll(_ call: CAPPluginCall) { discard(call, id: nil) }

    private func discard(_ call: CAPPluginCall, id: String?) {
        DispatchQueue.main.async {
            if id == nil || id == self.pendingId {
                // Invalidate permission/presentation callbacks and settle start
                // before waiting for UIKit dismissal or the file queue. Retain
                // the old controller locally; its late completion is ignored.
                let controller = self.activeCapture
                if let pending = self.pendingCall { self.resolveStart(pending, outcome: ["status": "cancelled"]) }
                controller?.abort()
            }
            CaptureFiles.queue.async {
                do {
                    try CaptureFiles.remove(id.map(CaptureFiles.folder) ?? CaptureFiles.root)
                    call.resolve()
                } catch { call.reject("Could not remove native capture files.") }
            }
        }
    }

    @objc func shareFile(_ call: CAPPluginCall) {
        guard let name = call.getString("fileName"),
              name.range(of: "\\A[A-Za-z0-9._-]{1,80}\\z", options: .regularExpression) != nil,
              name != ".", name != "..", let text = call.getString("text"),
              let bytes = text.data(using: .utf8), bytes.count <= 48 * 1024 * 1024 else {
            call.reject("Invalid share file (maximum 48 MiB)."); return
        }
        DispatchQueue.main.async {
            guard !self.sharing, self.pendingCall == nil, let presenter = self.bridge?.viewController,
                  presenter.presentedViewController == nil, presenter.viewIfLoaded?.window != nil else {
                call.reject("The share view is not available."); return
            }
            self.sharing = true
            let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            let url = directory.appendingPathComponent(name)
            CaptureFiles.queue.async {
                do {
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                                            attributes: [.protectionKey: FileProtectionType.complete])
                    try bytes.write(to: url, options: [.atomic, .completeFileProtection])
                    DispatchQueue.main.async {
                        guard presenter.presentedViewController == nil, presenter.viewIfLoaded?.window != nil else {
                            self.sharing = false
                            CaptureFiles.queue.async { try? CaptureFiles.remove(directory) }
                            call.reject("The share view is not available."); return
                        }
                        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                        sheet.popoverPresentationController?.sourceView = presenter.view
                        sheet.popoverPresentationController?.sourceRect = CGRect(origin: presenter.view.bounds.center, size: .zero)
                        sheet.completionWithItemsHandler = { _, completed, _, _ in
                            self.sharing = false
                            call.resolve(["completed": completed])
                            CaptureFiles.queue.async { try? CaptureFiles.remove(directory) }
                        }
                        presenter.present(sheet, animated: true)
                    }
                } catch {
                    try? CaptureFiles.remove(directory)
                    DispatchQueue.main.async { self.sharing = false; call.reject("Could not prepare the share file.") }
                }
            }
        }
    }
}

private extension CGRect {
    var center: CGPoint { CGPoint(x: midX, y: midY) }
}
