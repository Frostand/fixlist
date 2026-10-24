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
try? CaptureFiles.remove(CaptureFiles.root)
if failures.isEmpty { print("PASS: \(checks) native capture helper checks (no ARKit/device claim)") }
else {
    failures.forEach { print("FAIL: \($0)") }
    exit(1)
}
