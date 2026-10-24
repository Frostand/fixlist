// Compiled with the actual production helper declarations by the Python runner.
var checks = 0
var failures: [String] = []
func expect(_ condition: @autoclosure () -> Bool, _ description: String) {
    checks += 1
    if !condition() { failures.append(description) }
}

expect(CaptureFloorMath.select(previous: -1.2, heights: [-2.8, -1.15], locked: true) == -1.2,
       "New plane estimates must not move the floor already used by a corner or pending photo")
expect(CaptureFloorMath.select(previous: -0.4, heights: [-1.2, -0.3], locked: false) == -1.2,
       "An unused floor can improve before a point or photo uses it")
expect(CaptureFloorMath.select(previous: -1.2, heights: [], locked: true) == -1.2,
       "Anchor merging/removal must preserve the floor already used")
expect(CaptureFloorMath.select(previous: -1.2, heights: [], locked: false) == nil,
       "An unused surface reclassified as a table must stop being offered as floor")
for classification in [ARPlaneAnchor.Classification.table, .ceiling, .seat, .wall, .window, .door] {
    expect(CaptureFloorMath.candidate(height: -0.4, cameraY: 0, classification: classification) == nil,
           "A known nonfloor classification is not a floor: \(classification)")
}
for status in [ARPlaneAnchor.Classification.Status.notAvailable, .undetermined, .unknown] {
    expect(CaptureFloorMath.candidate(height: -1.2, cameraY: 0, classification: .none(status)) == -1.2,
           "The SDK's unclassified associated-value case permits fallback: \(status)")
}
expect(CaptureFloorMath.candidate(height: 1.2, cameraY: 0, classification: .none(.unknown)) == nil,
       "An unknown horizontal surface above the camera is not a floor")
expect(CaptureFloorMath.candidate(height: -1.2, cameraY: 0, classification: .floor) == -1.2,
       "A classified floor below the camera is eligible")
expect(CaptureFloorMath.candidate(height: -1.2, cameraY: .nan, classification: .floor) == nil,
       "Invalid tracking coordinates cannot select a floor")
expect(CaptureFloorMath.select(previous: nil, heights: [-1.2], locked: true) == nil,
       "Skipping the outline cannot acquire a new floor during the photo tour")
let floorHit = CaptureFloorMath.intersection(origin: SIMD3(0, 1.5, 0), direction: SIMD3(2, -1.5, -3), floorY: 0)
expect(floorHit.map { simd_distance($0, SIMD2(2, -3)) < 0.0001 } ?? false,
       "Floor taps use the saved floor even without a remaining detected anchor")
for direction in [SIMD3<Float>(0, 0, -1), SIMD3(0, 1, 0), SIMD3(0, 0, 0), SIMD3(.nan, -1, 0)] {
    expect(CaptureFloorMath.intersection(origin: SIMD3(0, 1.5, 0), direction: direction, floorY: 0) == nil,
           "Invalid/upward/horizon rays cannot create a floor point: \(direction)")
}
expect(CaptureFloorMath.intersection(origin: SIMD3(0, 1.5, 0), direction: SIMD3(20, -1.5, 0), floorY: 0) == nil,
       "Distant near-horizon floor intersections are refused")
expect(CaptureFloorMath.intersection(origin: SIMD3(0, -1, 0), direction: SIMD3(0, -1, 0), floorY: 0) == nil,
       "A floor behind the camera ray is refused")

// Existing portrait math: independently project sensor rays, then rotate pixels
// clockwise into the saved JPEG. Cover translation, odd resize and pixel edges.
let k = simd_float3x3(columns: (SIMD3(1200, 0, 0), SIMD3(0, 1180, 0), SIMD3(951, 533, 1)))
var sensor = matrix_identity_float4x4
sensor[3] = SIMD4(2, -1, 3, 1)
for (width, height) in [(1920, 1080), (1921, 1081), (1280, 720)] {
    guard let g = CapturePortraitMath.make(width: width, height: height, intrinsics: k, cameraToWorld: sensor) else {
        failures.append("Valid portrait geometry rejected")
        continue
    }
    expect(g.width <= 1600 && g.height <= 1600, "Portrait JPEG size cap")
    expect(simd_distance(g.transform[3], sensor[3]) < 0.00001, "Portrait rotation preserves camera centre")
    for p in [SIMD3<Float>(0, 0, -1), SIMD3(0.2, -0.15, -1), SIMD3(-0.3, 0.1, -2)] {
        let world = (sensor * SIMD4(p.x, p.y, p.z, 1)).xyz
        let sx = Double(g.width) / Double(height), sy = Double(g.height) / Double(width)
        let expected = CGPoint(x: (Double(height) - (533.5 - 1180 * Double(p.y / -p.z))) * sx,
                               y: (951.5 + 1200 * Double(p.x / -p.z)) * sy)
        let actual = g.project(world)
        expect(actual.map { hypot($0.x - expected.x, $0.y - expected.y) < 0.001 } ?? false,
               "Sensor-to-upright projection at \(width)x\(height), \(p)")
    }
    expect(g.project((sensor * SIMD4<Float>(0, 0, 1, 1)).xyz) == nil, "A point behind the camera cannot project")
}
expect(CapturePortraitMath.make(width: 0, height: 1080, intrinsics: k, cameraToWorld: sensor) == nil,
       "Empty sensor dimensions rejected")
CapturePortraitMath.selfTest()

// Full camera framing, not a separately stretched image: cover 3:4, 9:16,
// nonstandard/odd sensors, nonzero parent origins and changed layout shapes.
for resolution in [CGSize(width: 1920, height: 1440), CGSize(width: 1920, height: 1080),
                   CGSize(width: 1921, height: 1081), CGSize(width: 1920, height: 1200)] {
    for available in [CGRect(x: 0, y: 0, width: 390, height: 844),
                      CGRect(x: 17, y: 29, width: 430, height: 932),
                      CGRect(x: 11, y: 7, width: 844, height: 390)] {
        guard let frame = CaptureViewportMath.portraitFrame(in: available, imageResolution: resolution) else {
            failures.append("Valid camera/viewport rejected"); continue
        }
        expect(abs(frame.width / frame.height - resolution.height / resolution.width) < 0.000001,
               "ARView matches this sensor's full portrait aspect ratio")
        expect(abs(frame.midX - available.midX) < 0.000001 && abs(frame.midY - available.midY) < 0.000001,
               "ARView is centered even when the available bounds have a nonzero origin")
        expect(frame.width <= available.width + 0.000001 && frame.height <= available.height + 0.000001
               && (abs(frame.width - available.width) < 0.000001 || abs(frame.height - available.height) < 0.000001),
               "The whole camera fits and fills one available dimension")
        let width = Int(resolution.width), height = Int(resolution.height)
        let fullK = simd_float3x3(columns: (SIMD3(1200, 0, 0), SIMD3(0, 1180, 0),
                                           SIMD3(Float(width) / 2 - 0.5, Float(height) / 2 - 0.5, 1)))
        let geometry = CapturePortraitMath.make(width: width, height: height, intrinsics: fullK, cameraToWorld: sensor)!
        for p in [SIMD3<Float>(0, 0, -1), SIMD3(0.2, -0.15, -1), SIMD3(-0.3, 0.1, -2)] {
            let world = (sensor * SIMD4(p.x, p.y, p.z, 1)).xyz
            let saved = geometry.project(world)!
            let local = CGPoint(x: saved.x / Double(geometry.width) * frame.width,
                                y: saved.y / Double(geometry.height) * frame.height)
            // Independent clockwise sensor projection: no aspect-fill crop.
            let u = Double(width) / 2 + 1200 * Double(p.x / -p.z)
            let v = Double(height) / 2 - 1180 * Double(p.y / -p.z)
            let expected = CGPoint(x: (Double(height) - v) / Double(height) * frame.width,
                                   y: u / Double(width) * frame.height)
            expect(hypot(local.x - expected.x, local.y - expected.y) < 0.001,
                   "Center/off-center saved-photo projection agrees with full ARView local coordinates")
            let parent = CGPoint(x: frame.minX + local.x, y: frame.minY + local.y)
            expect(hypot(parent.x - frame.minX - expected.x, parent.y - frame.minY - expected.y) < 0.001,
                   "Parent viewport origin is added exactly once")
        }
    }
}
for bad in [CGSize.zero, CGSize(width: -1, height: 1440), CGSize(width: CGFloat.nan, height: 1440),
            CGSize(width: 1920, height: CGFloat.infinity)] {
    expect(CaptureViewportMath.portraitFrame(in: CGRect(x: 0, y: 0, width: 390, height: 844), imageResolution: bad) == nil,
           "Invalid camera dimensions cannot replace a valid viewport")
}
expect(CaptureViewportMath.portraitFrame(in: .zero, imageResolution: CGSize(width: 1920, height: 1440)) == nil,
       "Empty layout waits for valid bounds")
let viewport = CaptureOutlineHarness()
expect(!viewport.updateViewport() && viewport.arView.frameWrites == 0,
       "Before the first camera frame there is no hardcoded camera ratio")
expect(viewport.updateViewport(imageResolution: CGSize(width: 1920, height: 1440))
       && viewport.arView.frame == CGRect(x: 0, y: 162, width: 390, height: 520),
       "Production viewport applies the camera-derived 3:4 frame")
for _ in 0..<60 { _ = viewport.updateViewport(imageResolution: CGSize(width: 1920, height: 1440)) }
expect(viewport.arView.frameWrites == 1, "Unchanged camera frames do not mutate layout")
_ = viewport.updateViewport(imageResolution: CGSize(width: CGFloat.nan, height: 0))
expect(viewport.arView.frameWrites == 1 && viewport.cameraImageResolution == CGSize(width: 1920, height: 1440),
       "Invalid transient dimensions retain the last valid resolution")
viewport.view.bounds = CGRect(x: 17, y: 29, width: 430, height: 932)
expect(viewport.updateViewport() && viewport.arView.frameWrites == 2
       && abs(viewport.arView.frame.midX - viewport.view.bounds.midX) < 0.000001,
       "A layout change refits the last valid camera dimensions without a new AR frame")
expect(viewport.updateViewport(imageResolution: CGSize(width: 1920, height: 1080)) && viewport.arView.frameWrites == 3,
       "A camera format change refits the actual viewport")
viewport.view.bounds = CGRect(x: 11, y: 7, width: 844, height: 390)
expect(viewport.updateViewport() && viewport.arView.frameWrites == 4 && viewport.arView.frame.height == 390,
       "Rotation-sized layout changes refit the portrait camera without changing image orientation")
viewport.view.bounds = CGRect(x: 17, y: 29, width: 430, height: 932)
_ = viewport.updateViewport()
viewport.arView.hit = SIMD2(0.3, 0.6)
_ = viewport.placeAtCenter()
expect(viewport.arView.rayPoints.allSatisfy { $0 == CGPoint(x: viewport.arView.bounds.midX, y: viewport.arView.bounds.midY) },
       "Aim and + use the same fitted ARView local center")
viewport.arView.rayPoints = []
let offCenter = CGPoint(x: 51, y: 99)
viewport.arView.hit = SIMD2(0.4, 0.7)
viewport.tapped(UITapGestureRecognizer(parentPoint: CGPoint(x: viewport.arView.frame.minX + offCenter.x,
                                                          y: viewport.arView.frame.minY + offCenter.y)))
expect(viewport.arView.rayPoints.first == offCenter, "An off-center tap stays in ARView local coordinates")
let placedBeforeLetterbox = viewport.corners.count
viewport.arView.rayPoints = []
viewport.tapped(UITapGestureRecognizer(parentPoint: CGPoint(x: viewport.arView.frame.midX,
                                                          y: viewport.arView.frame.minY - 10)))
expect(viewport.corners.count == placedBeforeLetterbox && viewport.arView.rayPoints.isEmpty,
       "A parent-space letterbox tap is ignored after conversion into ARView local space")

// Regression: a narrow return/notch near the first corner must remain a new
// measured point. Exercise actual +, aim and tap-placement method bodies.
for centimeters in [4, 8, 12, 16, 20, 24] {
    for centerAction in [true, false] {
        let outline = CaptureOutlineHarness()
        let hit = SIMD2<Float>(0, Float(centimeters) / 100)
        outline.arView.hit = hit
        outline.updateAim()
        expect(outline.aimPosition.map { simd_distance($0, hit) < 0.00001 } ?? false,
               "Aim stays at the real intersection \(centimeters) cm from first")
        if centerAction { _ = outline.placeAtCenter() }
        else { outline.place(at: CGPoint(x: 80, y: 160)) }
        expect(outline.corners.count == 4 && outline.corners.last.map { simd_distance($0, hit) < 0.00001 } == true
               && !outline.closed && outline.step == .outline && outline.photoTransitions == 0,
               "\(centerAction ? "+" : "Tap") adds a distinct point \(centimeters) cm from first without closing")
    }
}
for hit in [SIMD2<Float>(0, 0), SIMD2(0, 0.02), SIMD2(0, 0.03), SIMD2(2, 2.02)] {
    let outline = CaptureOutlineHarness()
    outline.arView.hit = hit
    _ = outline.placeAtCenter()
    expect(outline.corners.count == 3 && !outline.closed && outline.photoTransitions == 0,
           "Existing 3 cm duplicate guard ignores first/last repeats without closing")
}
let notch = CaptureOutlineHarness()
notch.corners = []; notch.history = []
let notchPoints: [SIMD2<Float>] = [SIMD2(0, 0), SIMD2(2, 0), SIMD2(2, 2), SIMD2(0.2, 2), SIMD2(0.2, 0.12), SIMD2(0, 0.12)]
func samePoints(_ actual: [SIMD2<Float>], _ expected: [SIMD2<Float>]) -> Bool {
    actual.count == expected.count && zip(actual, expected).allSatisfy { simd_distance($0, $1) < 0.00001 }
}
for point in notchPoints { notch.arView.hit = point; _ = notch.placeAtCenter() }
expect(samePoints(notch.corners, notchPoints) && !notch.closed && notch.step == .outline,
       "A six-corner concave outline retains the narrow return and final near-first point")
notch.undoTapped()
expect(samePoints(notch.corners, Array(notchPoints.dropLast())) && notch.history.count == 5 && !notch.closed,
       "Undo removes only the most recent notch corner")
notch.arView.hit = notchPoints.last!; _ = notch.placeAtCenter()
notch.doorTapped()
let doorPoint = SIMD2<Float>(0.01, 0.01)
notch.arView.hit = doorPoint; _ = notch.placeAtCenter()
expect(samePoints(notch.doors, [doorPoint]) && samePoints(notch.corners, notchPoints) && !notch.doorMode && !notch.closed,
       "Door placement near the first corner records a door without closing or adding a corner")
notch.undoTapped()
expect(notch.doors.isEmpty && samePoints(notch.corners, notchPoints), "Undo removes a door independently of corners")
notch.closeTapped()
expect(notch.closed && notch.step == .photos && notch.photoTransitions == 1 && samePoints(notch.corners, notchPoints),
       "Only explicit Done closes a complete concave outline")
notch.closeTapped()
expect(notch.photoTransitions == 1, "A stale Done event cannot reenter photos")
let twoCorners = CaptureOutlineHarness()
twoCorners.corners.removeLast(); twoCorners.history.removeLast()
twoCorners.closeTapped()
expect(!twoCorners.closed && twoCorners.step == .outline, "Two corners cannot close")
for blockedState in ["floor", "photos", "finished", "saving", "limited", "interrupted"] {
    let outline = CaptureOutlineHarness()
    switch blockedState {
    case "floor": outline.step = .floor
    case "photos": outline.step = .photos
    case "finished": outline.finished = true
    case "saving": outline.saving = true
    case "limited": outline.trackingNormal = false
    default: outline.interrupted = true
    }
    outline.arView.hit = SIMD2(0, 0.12)
    outline.closeTapped(); _ = outline.placeAtCenter()
    expect(!outline.closed && outline.photoTransitions == 0 && outline.corners.count == 3,
           "Placement and Done are inert while \(blockedState)")
}
for blockedState in ["floor", "photos", "finished", "saving"] {
    let outline = CaptureOutlineHarness()
    switch blockedState {
    case "floor": outline.step = .floor
    case "photos": outline.step = .photos
    case "finished": outline.finished = true
    default: outline.saving = true
    }
    outline.undoTapped(); outline.doorTapped()
    expect(outline.corners.count == 3 && outline.history.count == 3 && !outline.doorMode,
           "Stale undo/door events preserve outline history while \(blockedState)")
}
let interruptedOutline = CaptureOutlineHarness()
interruptedOutline.interrupted = true; interruptedOutline.trackingNormal = false
interruptedOutline.arView.hit = SIMD2(0, 0.12)
_ = interruptedOutline.placeAtCenter(); interruptedOutline.closeTapped()
expect(interruptedOutline.aimPosition == nil && interruptedOutline.corners.count == 3 && !interruptedOutline.closed,
       "Interruption suppresses aiming, adding and closing without losing corners")
interruptedOutline.interrupted = false; interruptedOutline.trackingNormal = true
_ = interruptedOutline.placeAtCenter()
expect(interruptedOutline.corners.count == 4 && !interruptedOutline.closed,
       "Recovered tracking can add the same near-first point to the preserved outline")
let letterbox = CaptureOutlineHarness()
for point in [CGPoint(x: -1, y: 100), CGPoint(x: 100, y: -1), CGPoint(x: 391, y: 100), CGPoint(x: 100, y: 845)] {
    letterbox.place(at: point)
}
expect(letterbox.arView.rayPoints.isEmpty && letterbox.corners.count == 3,
       "Letterbox input outside actual ARView bounds cannot raycast or place")

let capture = CaptureStateHarness()
capture.resetTapped()
expect(capture.presentedViewController?.actions.count == 2 && capture.worldGeneration == 2,
       "Restart with drawing/photos must ask before changing capture state")
let cancel = capture.presentedViewController!.actions.first { $0.style == .cancel }!
cancel.handler?(cancel)
expect(capture.corners.count == 3 && capture.floorY == -1.2 && capture.photos[0].camera == true
       && capture.pendingPhoto?.camera == true && capture.arView.session.resets == 0,
       "Canceling restart preserves drawing, pending photo, poses and world")
let restart = capture.presentedViewController!.actions.first { $0.style == .destructive }!
restart.handler?(restart)
expect(capture.discardedVideoAttempts == 1, "Production tracking reset discards the active video attempt")
expect(capture.worldGeneration == 3 && capture.floorY == nil && capture.planeHeights.isEmpty
       && capture.corners.isEmpty && capture.doors.isEmpty && capture.history.isEmpty
       && !capture.closed && !capture.doorMode && capture.overlay.children.isEmpty,
       "Confirmed restart clears all drawing state and invalidates the previous world")
expect(capture.photos.count == 1 && capture.photos[0].camera == nil && capture.pendingPhoto?.camera == nil,
       "Restart preserves retained/pending JPEG records but discards their old poses")
expect(capture.step == .floor && !capture.trackingNormal && !capture.interrupted && !capture.relocalizing
       && capture.resetNotice && capture.arView.session.resets == 1,
       "Restart returns an outline draft to floor search and runs one world reset")
expect(capture.receivePhoto(generation: 2).camera == nil,
       "An in-flight JPEG from the old world cannot restore its stale camera pose")
expect(capture.receivePhoto(generation: 3).camera == true,
       "A JPEG from the current world retains its camera pose")
capture.step = .photos
capture.resetWorld()
expect(capture.step == .photos, "Restart during guided photos keeps the current photo-tour step")
capture.finished = true
let stoppedGeneration = capture.worldGeneration
capture.resetWorld()
expect(capture.worldGeneration == stoppedGeneration && capture.arView.session.resets == 2,
       "A closed capture cannot restart its AR session")

func nativeOptions(_ id: String = "cap-options-0001", language: String = "en") -> [String: Any] {
    ["captureId": id, "roomId": "living-room", "roomName": "Room", "language": language,
     "prompts": [["checklistItemId": NSNull(), "text": "Overview"], ["checklistItemId": "rug-check", "text": "Rug"]],
     "strings": ["done": "Localized done", "cancel": "", "undo": 17]]
}
for code in ["en", "es", "zh", "vi", "ko", "tl", "ru", "fr", "ar"] {
    let options = CaptureOptions(call: CAPPluginCall(nativeOptions(language: code)))
    expect(options != nil, "Actual Swift CaptureOptions accepts \(code)")
    expect(options?.strings["done"] == "Localized done", "Bridged localized string retained for \(code)")
    expect(options?.strings["cancel"] == CaptureOptions.english["cancel"] && options?.strings["undo"] == CaptureOptions.english["undo"],
           "Individual empty/non-string translations use English fallback for \(code)")
}
expect(CaptureOptions(call: CAPPluginCall(nativeOptions(language: "xx"))) == nil, "Unknown language rejected")
for bad in [["text": "Missing ID"], ["checklistItemId": 4, "text": "Numeric ID"], ["checklistItemId": "", "text": "Empty ID"]] as [[String: Any]] {
    var options = nativeOptions(); options["prompts"] = [bad]
    expect(CaptureOptions(call: CAPPluginCall(options)) == nil, "Actual Swift parser rejects malformed prompt IDs")
}
func drain(until condition: () -> Bool) {
    let deadline = Date().addingTimeInterval(3)
    while !condition() && Date() < deadline { _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.005)) }
    expect(condition(), "Native callback completed within host-test deadline")
}
let lifecycle = NativeLifecycleHarness()
AVCaptureDevice.status = .notDetermined
let permissionA = CAPPluginCall(nativeOptions("cap-permission-a01"))
lifecycle.start(permissionA)
drain { AVCaptureDevice.permissions.count == 1 }
let permissionCallback = AVCaptureDevice.permissions.removeFirst()
let discardPermission = CAPPluginCall()
lifecycle.discard(discardPermission, id: "cap-permission-a01")
drain { discardPermission.resolutions.count == 1 }
expect(permissionA.resolutions.count == 1 && permissionA.resolutions[0]["status"] as? String == "cancelled", "Pending permission cancellation settles start once")
let permissionB = CAPPluginCall(nativeOptions("cap-permission-b01"))
lifecycle.start(permissionB)
drain { AVCaptureDevice.permissions.count == 1 }
permissionCallback(true)
_ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
expect(lifecycle.pendingCall === permissionB && lifecycle.bridge?.viewController?.presentations == 0, "Late permission A cannot present or cancel B")
let discardOld = CAPPluginCall(); lifecycle.discard(discardOld, id: "cap-permission-a01")
drain { discardOld.resolutions.count == 1 }
expect(lifecycle.pendingCall === permissionB && permissionB.resolutions.isEmpty, "Late ID-scoped discard cannot cancel B")
let discardB = CAPPluginCall(); lifecycle.discard(discardB, id: "cap-permission-b01")
drain { discardB.resolutions.count == 1 }
AVCaptureDevice.permissions.removeFirst()(true)
AVCaptureDevice.status = .authorized
CaptureFiles.queue.suspend()
let prep = CAPPluginCall(nativeOptions("cap-file-prep-001"))
lifecycle.start(prep)
drain { lifecycle.pendingCall === prep }
let discardPrep = CAPPluginCall(); lifecycle.discard(discardPrep, id: "cap-file-prep-001")
drain { prep.resolutions.count == 1 }
CaptureFiles.queue.resume()
drain { discardPrep.resolutions.count == 1 }
expect(!FileManager.default.fileExists(atPath: CaptureFiles.folder("cap-file-prep-001").path), "Cancellation cleans queued directory creation")
expect(lifecycle.bridge?.viewController?.presentations == 0 && prep.resolutions.count == 1, "Queued creation callback cannot present or settle again")
let active = CAPPluginCall(nativeOptions("cap-active-test-01"))
lifecycle.start(active)
drain { lifecycle.activeCapture != nil }
let oldController = lifecycle.activeCapture!
let discardActive = CAPPluginCall(); lifecycle.discard(discardActive, id: "cap-active-test-01")
drain { discardActive.resolutions.count == 1 }
expect(oldController.aborts == 1 && active.resolutions.count == 1 && lifecycle.pendingCall == nil, "Active cancellation invalidates and settles before delayed dismissal callback")
let newer = CAPPluginCall(nativeOptions("cap-active-test-02"))
lifecycle.bridge?.viewController?.presentedViewController = nil
lifecycle.start(newer)
drain { lifecycle.pendingCall === newer }
oldController.completion(["status": "completed"])
expect(lifecycle.pendingCall === newer && active.resolutions.count == 1 && newer.resolutions.isEmpty, "Late controller completion cannot settle or clear the new ID")
let discardNewer = CAPPluginCall(); lifecycle.discard(discardNewer, id: "cap-active-test-02")
drain { discardNewer.resolutions.count == 1 }
// Production controller lifecycle: no camera/UI animation is simulated as physical evidence.
let videoLifecycle = CaptureVideoLifecycleHarness()
let clipURL = CaptureFiles.folder(videoLifecycle.options.captureId).appendingPathComponent("v01.mp4")
let savedClip = CaptureVideo(takenAt: "2026-10-24T01:02:03.000Z", width: 180, height: 320,
                            durationMs: 1000, byteLength: 1000, sha256: String(repeating: "a", count: 64), url: clipURL)
videoLifecycle.acceptedVideo = savedClip
videoLifecycle.skipTapped()
expect(!videoLifecycle.finished && videoLifecycle.outcomes.isEmpty && videoLifecycle.removedPhotos == 0
       && videoLifecycle.acceptedVideo?.url == clipURL && videoLifecycle.videoNotice == "videoNeedsPhoto",
       "Final Skip warns and preserves accepted clip with zero photos")
if videoLifecycle.finished { print("FAIL: Final Skip deleted the video-only capture instead of warning"); exit(1) }
videoLifecycle.completeCapture()
expect(!videoLifecycle.finished, "Video alone cannot complete a room capture")
videoLifecycle.videoState = .recording
videoLifecycle.videoGeneration = UUID()
videoLifecycle.candidateVideo = savedClip
videoLifecycle.sessionWasInterrupted(videoLifecycle.arView.session)
expect(videoLifecycle.videoGeneration == nil && videoLifecycle.candidateVideo == nil
       && videoLifecycle.videoWriter.cancels == 1 && videoLifecycle.acceptedVideo?.url == clipURL
       && videoLifecycle.interrupted && videoLifecycle.videoNotice == "videoStopped",
       "Interruption discards candidate and preserves accepted clip")
videoLifecycle.videoState = .recording
videoLifecycle.videoGeneration = UUID()
videoLifecycle.pauseCaptureForBackground()
expect(videoLifecycle.videoGeneration == nil && videoLifecycle.videoWriter.cancels == 2
       && videoLifecycle.acceptedVideo?.url == clipURL && videoLifecycle.interrupted,
       "Backgrounding discards active take and retains accepted video")
videoLifecycle.photos = [LifecyclePhoto(photoId: "p01", url: clipURL.deletingLastPathComponent().appendingPathComponent("p01.jpg"))]
videoLifecycle.session(videoLifecycle.arView.session, didFailWithError: NSError(domain: "AR-test", code: 99))
expect(videoLifecycle.beganPhotos && videoLifecycle.photos.count == 1 && !videoLifecycle.finished,
       "Unrecoverable tracking leaves accepted photos finishable")
videoLifecycle.completeCapture()
expect(videoLifecycle.finished && videoLifecycle.outcomes.isEmpty, "Completed result waits for dismissal")
videoLifecycle.pendingDismiss?()
expect(videoLifecycle.outcomes.count == 1, "Completed result settles once")
let bridgeCapture = videoLifecycle.outcomes[0]["capture"] as! [String: Any]
let bridgeFiles = bridgeCapture["files"] as! [String: String]
let bridgeVideos = bridgeCapture["videos"] as! [String: Any]
expect(Set(bridgeFiles.keys) == ["p01", "v01"] && bridgeFiles["v01"] == clipURL.absoluteString,
       "Bridge files contain exactly photo IDs plus v01")
expect(bridgeVideos["format"] as? String == "fixlist-capture-videos" && bridgeVideos["version"] as? Int == 1
       && bridgeVideos["captureId"] as? String == videoLifecycle.options.captureId
       && bridgeVideos["roomId"] as? String == videoLifecycle.options.roomId,
       "Video sidecar binds exact capture and room")
let videoJSON = (bridgeVideos["clips"] as! [[String: Any]])[0]
expect(Set(videoJSON.keys) == ["videoId", "takenAt", "mimeType", "codec", "width", "height", "durationMs", "byteLength", "sha256"]
       && videoJSON["videoId"] as? String == "v01" && bridgeCapture["videoFiles"] == nil,
       "Clip has exact media fields with no checklist/pose or separate videoFiles")
let photoOnly = CaptureVideoLifecycleHarness()
photoOnly.photos = videoLifecycle.photos
photoOnly.completeCapture(); photoOnly.pendingDismiss?()
expect((photoOnly.outcomes[0]["capture"] as! [String: Any])["videos"] == nil,
       "Legacy photo-only result omits videos and preserves v1 keys")
let abortVideo = CaptureVideoLifecycleHarness()
abortVideo.videoGeneration = UUID(); abortVideo.videoState = .recording
abortVideo.abort()
expect(abortVideo.cancellationsAtDismiss == 1 && abortVideo.videoGeneration == nil,
       "Whole-capture abort enqueues writer cancellation before UIKit dismissal")
CaptureFiles.queue.suspend()
abortVideo.pendingDismiss?()
expect(abortVideo.outcomes.isEmpty, "Abort never claims folder cleanup before queue completes")
CaptureFiles.queue.resume()
drain { abortVideo.outcomes.count == 1 }
expect(abortVideo.outcomes[0]["status"] as? String == "cancelled", "Abort settles after queued cleanup")
let committing = CaptureVideoLifecycleHarness()
committing.acceptedVideo = savedClip
committing.candidateVideo = savedClip
committing.videoState = .reviewing
committing.videoGeneration = UUID()
committing.photos = videoLifecycle.photos
committing.useVideoTapped()
committing.pauseCaptureForBackground()
committing.completeCapture()
expect(!committing.finished && committing.videoCommitPending && !committing.isVideoIdle,
       "Interruption waits for atomic Use result before permitting Done")
let newClip = CaptureVideo(takenAt: savedClip.takenAt, width: 180, height: 320, durationMs: 2000,
                           byteLength: 2000, sha256: String(repeating: "b", count: 64), url: clipURL)
committing.videoWriter.pendingUse?(.success(newClip))
expect(committing.acceptedVideo?.sha256 == newClip.sha256 && committing.isVideoIdle,
       "Replacement committed before interruption reconciles accepted metadata")
committing.completeCapture(); committing.pendingDismiss?()
let committedSidecar = (committing.outcomes[0]["capture"] as! [String: Any])["videos"] as! [String: Any]
expect((committedSidecar["clips"] as! [[String: Any]])[0]["sha256"] as? String == newClip.sha256,
       "Final manifest describes committed bytes after interruption")
let failedCleanup = CaptureVideoLifecycleHarness()
CaptureFiles.failRemove = true
failedCleanup.abort(); failedCleanup.pendingDismiss?()
drain { failedCleanup.outcomes.count == 1 }
expect(failedCleanup.outcomes[0]["cleanupFailed"] as? Bool == true, "Native cleanup failure is returned visibly")
CaptureFiles.failRemove = false
try? CaptureFiles.remove(CaptureFiles.root)
if failures.isEmpty { print("PASS: \(checks) native capture helper checks (no ARKit/device claim)") }
else {
    failures.forEach { print("FAIL: \($0)") }
    exit(1)
}
