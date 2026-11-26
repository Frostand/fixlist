// Production tour geometry, projection, target selection and stitcher. All
// imagery below is analytically generated; no household images are opened.
for y in stride(from: 0, to: 2048, by: 37) {
    for x in stride(from: 0, to: 4096, by: 53) {
        let d = CaptureTourMath.direction(x: Float(x) + 0.5, y: Float(y) + 0.5, width: 4096, height: 2048)
        let p = CaptureTourMath.pixel(d, width: 4096, height: 2048)
        expect(abs(p.x - Float(x) - 0.5) < 0.003 && abs(p.y - Float(y) - 0.5) < 0.08,
               "Equirect pixel centre round trip, including seam/poles")
    }
}
expect(simd_distance(CaptureTourMath.direction(x: 2048, y: 1024, width: 4096, height: 2048), SIMD3(0, 0, -1)) < 0.00001,
       "Equirect centre faces world minus Z")
expect(simd_distance(CaptureTourMath.direction(x: 3072, y: 1024, width: 4096, height: 2048), SIMD3(1, 0, 0)) < 0.00001,
       "Increasing longitude turns toward world plus X")
let compactGeometry = CapturePortraitMath.make(width: 1920, height: 1440,
    intrinsics: simd_float3x3(columns: (SIMD3(1400, 0, 0), SIMD3(0, 1400, 0), SIMD3(959.5, 719.5, 1))),
    cameraToWorld: sensor, maxDimension: 960)!
expect(compactGeometry.width == 720 && compactGeometry.height == 960, "Tour rasters immediately reduce to 720 by 960")
for y in stride(from: 1, to: 960, by: 71) { for x in stride(from: 1, to: 720, by: 61) {
    let d = CaptureTourMath.ray(x: Float(x) + 0.5, y: Float(y) + 0.5, geometry: compactGeometry)
    let p = CaptureTourMath.project(d, geometry: compactGeometry)!
    let worldPoint = compactGeometry.transform[3].xyz + d * 4
    let original = compactGeometry.project(worldPoint)!
    expect(abs(p.x - Float(x) - 0.5) < 0.001 && abs(p.y - Float(y) - 0.5) < 0.001
           && abs(Double(p.x) - original.x) < 0.001 && abs(Double(p.y) - original.y) < 0.001,
           "Direction projection agrees with translated portrait point projection")
} }
let targets = CaptureTourMath.targets(yaw: 0.173)
expect(targets.count == 24 && targets.prefix(12).allSatisfy { abs($0.y) < 0.00001 }
       && targets.suffix(12).allSatisfy { abs($0.y + sqrt(0.5)) < 0.00001 }, "Two rings cover level and minus 45 degrees")
for i in targets.indices {
    expect(CaptureTourMath.select(forward: targets[i], targets: targets, captured: [], trackingNormal: true, angularVelocity: 0.1) == i,
           "Settled target is captured on either ring")
    expect(CaptureTourMath.select(forward: targets[i], targets: targets, captured: [i], trackingNormal: true, angularVelocity: 0.1) == nil,
           "Already captured target is not duplicated")
}
expect(CaptureTourMath.select(forward: targets[0], targets: targets, captured: [], trackingNormal: false, angularVelocity: 0) == nil,
       "Limited tracking cannot capture a target")
expect(CaptureTourMath.select(forward: targets[0], targets: targets, captured: [], trackingNormal: true, angularVelocity: 0.5) == nil,
       "Fast rotation cannot capture a target")
expect(CaptureTourMath.select(forward: SIMD3(0, 1, 0), targets: targets, captured: [], trackingNormal: true, angularVelocity: 0) == nil,
       "Off-target view cannot capture")
expect(!CaptureTourMath.canFinish(14) && CaptureTourMath.canFinish(15) && CaptureTourMath.canFinish(24)
       && !CaptureTourMath.canFinish(25), "Finish starts at 15 of 24 targets")
expect(CaptureTourMath.nearOrigin(SIMD3(0.5, 0, 0), origin: .zero)
       && !CaptureTourMath.nearOrigin(SIMD3(0.7, 0, 0), origin: .zero), "Movement gate allows turning in place while refusing walking")
let stillSpeed = CaptureTourMath.angularVelocity(previous: sensor, current: sensor, elapsed: 1.0 / 60)
var rolling = sensor
rolling = rolling * simd_float4x4(simd_quatf(angle: 0.1, axis: SIMD3(0, 0, 1)))
expect(stillSpeed < 0.001 && CaptureTourMath.angularVelocity(previous: sensor, current: rolling, elapsed: 0.1) > 0.9,
       "Blur gate includes roll, not only forward direction")
expect(!CaptureTourMath.angularVelocity(previous: sensor, current: sensor, elapsed: 1).isFinite,
       "Interruption invalidates the velocity sample")

let testStop = CaptureTourStop(stopId: "s1", position: SIMD3(1, 1.4, -2), capturedAt: "2026-10-25T23:01:02.000Z",
    width: 4096, height: 2048, sha256: String(repeating: "a", count: 64), coverage: 0.75,
    url: URL(fileURLWithPath: "/tmp/fixlist-synthetic-pano.jpg"))
let tourOnly = CaptureVideoLifecycleHarness()
tourOnly.tourStops = [testStop]
tourOnly.completeCapture(); tourOnly.pendingDismiss?()
let tourManifest = tourOnly.outcomes.first?["capture"] as? [String: Any]
let tourObject = tourManifest?["tour"] as? [String: Any]
let stopJSON = (tourObject?["stops"] as? [[String: Any]])?.first
let panoJSON = stopJSON?["panorama"] as? [String: Any]
expect(tourOnly.finished && (tourManifest?["photos"] as? [Any])?.isEmpty == true, "Tour with zero photos completes")
expect(Set(tourObject?.keys.map { $0 } ?? []) == ["format", "version", "stops"]
       && tourObject?["format"] as? String == "fixlist-room-tour" && tourObject?["version"] as? Int == 1,
       "Tour manifest has exact versioned shape")
expect(Set(stopJSON?.keys.map { $0 } ?? []) == ["stopId", "position", "panorama", "capturedAt"]
       && stopJSON?["position"] as? [Double] == [1, Double(Float(1.4)), -2]
       && stopJSON?["stopId"] as? String == "s1", "Stop stores world mean position and UTC time")
expect(Set(panoJSON?.keys.map { $0 } ?? []) == ["fileId", "width", "height", "sha256", "coverage"]
       && panoJSON?["fileId"] as? String == "pano-s1" && panoJSON?["width"] as? Int == 4096
       && panoJSON?["height"] as? Int == 2048 && panoJSON?["sha256"] as? String == testStop.sha256
       && panoJSON?["coverage"] as? Double == 0.75, "Panorama contract matches the shared interface")
expect((tourManifest?["files"] as? [String: String]) == ["pano-s1": testStop.url.absoluteString], "Panorama file joins the common files map")
let skipWithTour = CaptureVideoLifecycleHarness()
skipWithTour.tourStops = [testStop]; skipWithTour.skipTapped(); skipWithTour.pendingDismiss?()
expect(skipWithTour.finished && skipWithTour.outcomes.first?["status"] as? String == "completed",
       "Skipping the final photo preserves and completes the tour")
let mixedTour = CaptureVideoLifecycleHarness()
mixedTour.tourStops = [testStop]; mixedTour.photos = videoLifecycle.photos; mixedTour.acceptedVideo = savedClip
mixedTour.completeCapture(); mixedTour.pendingDismiss?()
expect(Set(((mixedTour.outcomes.first?["capture"] as? [String: Any])?["files"] as? [String: String] ?? [:]).keys)
       == ["pano-s1", "p01", "v01"], "Video file merging preserves panoramas and photos")
let busyTour = CaptureVideoLifecycleHarness()
busyTour.tourStops = [testStop]; busyTour.tourBusy = true; busyTour.completeCapture()
expect(!busyTour.finished, "Pending frame/stitch prevents premature Done")
let sevenStops = CaptureVideoLifecycleHarness()
sevenStops.tourStops = (1...7).map { i in CaptureTourStop(stopId: "s\(i)", position: .zero, capturedAt: testStop.capturedAt,
    width: 4096, height: 2048, sha256: testStop.sha256, coverage: 0.5, url: testStop.url) }
sevenStops.completeCapture()
expect(!sevenStops.finished, "Native completion refuses more than six stops")
let resetTour = CaptureStateHarness()
resetTour.tourStops = [testStop]; resetTour.tourBusy = true; resetTour.resetWorld()
expect(resetTour.tourStops.isEmpty && !resetTour.tourBusy && resetTour.tourInvalidations == 1,
       "Production reset invalidates tour world before restarting ARKit")

let attempt = CaptureTourAttemptHarness()
let oldAttemptToken = attempt.tourCancellation
attempt.clearTourAttempt()
expect(oldAttemptToken.isCancelled && !attempt.tourCancellation.isCancelled && attempt.tourState == .ready
       && !attempt.tourFramePending && attempt.tourCaptured.isEmpty && attempt.tourTargets.isEmpty
       && attempt.tourPositionCount == 0 && attempt.tourPositionSum == .zero
       && attempt.tourPreviousPose == nil && attempt.tourStableSince == nil
       && attempt.tourDots.allSatisfy { $0.isHidden }, "Production clear cancels the old worker and drops all transient state")
let staleURL = FileManager.default.temporaryDirectory.appendingPathComponent("fixlist-tour-test-" + UUID().uuidString + ".jpg")
try Data([1, 2, 3]).write(to: staleURL)
attempt.tourStops = [CaptureTourStop(stopId: "s1", position: .zero, capturedAt: testStop.capturedAt,
    width: 4096, height: 2048, sha256: testStop.sha256, coverage: 0.5, url: staleURL)]
attempt.invalidateTourWorld()
CaptureFiles.queue.sync {}
expect(attempt.tourStops.isEmpty && attempt.tourState == .ready && !FileManager.default.fileExists(atPath: staleURL.path),
       "Production world invalidation deletes old panorama files on the capture queue")
let buildingAttempt = CaptureTourAttemptHarness()
let buildingFolder = CaptureFiles.folder(buildingAttempt.options.captureId)
try FileManager.default.createDirectory(at: buildingFolder, withIntermediateDirectories: true)
let buildingURL = buildingFolder.appendingPathComponent("pano-s1.jpg")
try Data([8, 9]).write(to: buildingURL)
buildingAttempt.tourState = .building
buildingAttempt.clearTourAttempt()
CaptureFiles.queue.sync {}
expect(!FileManager.default.fileExists(atPath: buildingURL.path), "Cancelling a building spot queues exact filename cleanup")
try Data([10, 11]).write(to: buildingURL)
buildingAttempt.tourState = .review
buildingAttempt.clearTourAttempt()
CaptureFiles.queue.sync {}
expect(FileManager.default.fileExists(atPath: buildingURL.path), "Clearing a completed attempt preserves accepted panorama bytes")
try CaptureFiles.remove(buildingURL)
expect(tourOnly.tourClears == 1, "Production finish cancels and releases the in-flight tour attempt")
var translatedTourOptions = nativeOptions()
translatedTourOptions["strings"] = ["stepTour": "Vista de 360°", "tourStart": "Iniciar", "tourBuilding": "Creando…"]
let translatedTour = CaptureOptions(call: CAPPluginCall(translatedTourOptions))!
expect(translatedTour.strings["tourStart"] == "Iniciar" && translatedTour.strings["stepTour"] == "Vista de 360°"
       && translatedTour.strings["tourBuilding"] == "Creando…", "Native allowlist accepts the added translated tour keys")

// The same CGImage-to-RGBA boundary used by the iPhone must retain rows.
let rowPixels = Data([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255])
let rowImage = CGImage(width: 2, height: 2, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: 8,
    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
    provider: CGDataProvider(data: rowPixels as CFData)!, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
let rasterRows = try CaptureTourRaster.rgba(rowImage)
var rowsMatch = true
let actualRows = [UInt8](rasterRows), expectedRows = [UInt8](rowPixels)
for i in 0..<4 { for k in 0..<3 { if actualRows[i * 4 + k] != expectedRows[i * 4 + k] { rowsMatch = false } } }
expect(rowsMatch,
       "Compact raster conversion keeps portrait top row first without flipping")

// A textured cube room at a fixed centre. Faces have distinct base colours;
// sinusoidal surface texture makes axis flips and rotation errors measurable.
func cubeColor(_ d: SIMD3<Float>) -> SIMD3<Float> {
    let a = abs(d)
    let axis = a.x >= a.y && a.x >= a.z ? 0 : a.y >= a.z ? 1 : 2
    let p = d / a[axis]
    let bases = [SIMD3<Float>(155, 80, 100), SIMD3(80, 155, 100), SIMD3(100, 80, 155)]
    let u = p[(axis + 1) % 3], v = p[(axis + 2) % 3]
    let texture = 23 * sin(u * 13) * cos(v * 11) + 10 * sin((u + v) * 21)
    return bases[axis] + SIMD3<Float>(repeating: texture + (d[axis] > 0 ? 14 : -14))
}
let syntheticFrames: [CaptureTourFrame] = targets.enumerated().map { index, forward in
    let right = simd_normalize(simd_cross(forward, SIMD3<Float>(0, 1, 0)))
    let up = simd_cross(right, forward)
    let transform = simd_float4x4(columns: (SIMD4(right, 0), SIMD4(up, 0), SIMD4(-forward, 0), SIMD4(0, 0, 0, 1)))
    let g = CapturePortraitMath.Geometry(width: 720, height: 960, transform: transform, intrinsics: [700, 700, 360, 480])
    var data = Data(count: 720 * 960 * 4)
    data.withUnsafeMutableBytes { raw in
        let p = raw.bindMemory(to: UInt8.self)
        for y in 0..<960 { for x in 0..<720 {
            let d = CaptureTourMath.ray(x: Float(x) + 0.5, y: Float(y) + 0.5, geometry: g)
            let c = cubeColor(d) * (1 + 0.035 * sin(Float(index) * 1.7))
            let offset = (y * 720 + x) * 4
            for k in 0..<3 { p[offset + k] = UInt8(max(0, min(255, c[k].rounded()))) }
            p[offset + 3] = 255
        } }
    }
    return CaptureTourFrame(geometry: g, pixels: data)
}
let stitch = try CaptureTourStitcher.stitch(syntheticFrames)
let pngURL = URL(fileURLWithPath: "/tmp/fixlist-pano-synthetic.png")
let png = CGImageDestinationCreateWithURL(pngURL as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(png, stitch.image, nil)
expect(CGImageDestinationFinalize(png), "Synthetic stitched PNG saved outside git")
let stitchedBytes = CFDataGetBytePtr(stitch.image.dataProvider!.data!)!
var errorSum: Double = 0, samples = 0, coveredPixels = 0, greyPixels = 0
for y in 0..<2048 { for x in 0..<4096 {
    let offset = (y * 4096 + x) * 4
    if stitchedBytes[offset + 3] == 255 {
        coveredPixels += 1
        if x % 4 == 0 && y % 4 == 0 {
            let expected = cubeColor(CaptureTourMath.direction(x: Float(x) + 0.5, y: Float(y) + 0.5, width: 4096, height: 2048))
            for k in 0..<3 { errorSum += abs(Double(stitchedBytes[offset + k]) - Double(expected[k])); samples += 1 }
        }
    } else {
        if stitchedBytes[offset] == 128 && stitchedBytes[offset + 1] == 128 && stitchedBytes[offset + 2] == 128 { greyPixels += 1 }
    }
} }
let meanError = errorSum / Double(samples)
expect(meanError < 2, "Synthetic cube stitch mean error below 2 of 255 per RGB channel")
expect(abs(stitch.coverage - Double(coveredPixels) / Double(4096 * 2048)) < 0.00000001
       && coveredPixels + greyPixels == 4096 * 2048 && stitch.coverage > 0.6 && stitch.coverage < 0.9,
       "Coverage counts filled pixels and all remaining pixels are neutral grey")
// Independent geometric union at every output pixel of a small panorama.
let small = try CaptureTourStitcher.stitch([syntheticFrames[0]], width: 128, height: 64)
var expectedCovered = 0
for y in 0..<64 { for x in 0..<128 {
    let d = CaptureTourMath.direction(x: Float(x) + 0.5, y: Float(y) + 0.5, width: 128, height: 64)
    if let p = CaptureTourMath.project(d, geometry: syntheticFrames[0].geometry),
       p.x >= 0.5, p.x < 719.5, p.y >= 0.5, p.y < 959.5 { expectedCovered += 1 }
} }
expect(abs(small.coverage - Double(expectedCovered) / (128 * 64)) < 0.000001, "Pre-culling preserves independently projected coverage")
let cancelledStitch = CaptureTourCancellation(); cancelledStitch.cancel()
do { _ = try CaptureTourStitcher.stitch(syntheticFrames, width: 128, height: 64, cancellation: cancelledStitch)
    expect(false, "Cancelled stitch must not return an image")
} catch { expect(true, "Cancelled stitch discards its output") }
let panoramaJPEG = try CaptureJPEG.encode(stitch.image)
let panoramaProperties = CGImageSourceCopyPropertiesAtIndex(CGImageSourceCreateWithData(panoramaJPEG as CFData, nil)!, 0, nil) as! [CFString: Any]
expect(CaptureJPEG.isPrivate(panoramaProperties), "Panorama JPEG uses the production metadata privacy encoder")
print(String(format: "TOUR SYNTHETIC: 24 x 720x960 -> 4096x2048; stitch %.3f s; mean RGB error %.4f / 255; coverage %.5f; PNG %@",
             stitch.seconds, meanError, stitch.coverage, pngURL.path))
