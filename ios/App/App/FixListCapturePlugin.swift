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
    /// Optional `-FixListCaptureUIPreviewState N` (0-4) starts the preview at a given state for screenshots.
    static var initialState: Int {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: "-FixListCaptureUIPreviewState"), index + 1 < args.count,
              let value = Int(args[index + 1]), (0..<5).contains(value) else { return 0 }
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
        "stepOutline": "Step 1 of 2 · Outline the floor",
        "stepPhotos": "Step 2 of 2 · Photos",
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
        "cancelConfirmStop": "Stop and remove photos", "cancelConfirmKeep": "Keep going"
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
              let language = call.getString("language"), ["en", "es"].contains(language),
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
            .appendingPathComponent("fixlist-captures", isDirectory: true)
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
                     cameraToWorld: simd_float4x4) -> Geometry? {
        guard width > 0, height > 0 else { return nil }
        let scale = min(1, 1600 / Double(max(width, height)))
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

enum CapturePhotoWriter {
    enum Failure: Error { case geometry, rendering, jpeg, metadata }
    // Called only on CaptureFiles.queue. CGImage carries pixels, not the source
    // photo's metadata. ImageIO receives only our JPEG quality setting.
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
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil)
        else { throw Failure.jpeg }
        CGImageDestinationSetProperties(destination, [:] as CFDictionary)
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw Failure.jpeg }
        let bytes = data as Data
        guard let source = CGImageSourceCreateWithData(bytes as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              properties[kCGImagePropertyExifDictionary] == nil,
              properties[kCGImagePropertyGPSDictionary] == nil,
              properties[kCGImagePropertyTIFFDictionary] == nil,
              properties[kCGImagePropertyExifAuxDictionary] == nil else { throw Failure.metadata }
        let url = CaptureFiles.folder(options.captureId).appendingPathComponent(photoId + ".jpg")
        try bytes.write(to: url, options: [.atomic, .completeFileProtection])
        let camera: [String: Any] = ["transform": geometry.flatTransform, "intrinsics": geometry.intrinsics, "tracking": "normal"]
        return (CapturePhoto(photoId: photoId, checklistItemId: checklistItemId, takenAt: takenAt,
                             width: geometry.width, height: geometry.height,
                             sha256: SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(),
                             camera: camera, url: url), bytes)
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
                    guard self.pendingCall === call else { return }
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
                if let controller = self.activeCapture { controller.abort() }
                else if let pending = self.pendingCall { self.resolveStart(pending, outcome: ["status": "cancelled"]) }
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
