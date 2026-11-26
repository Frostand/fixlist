import Foundation
import CoreML
import Vision
import CoreGraphics
import ImageIO
#if canImport(Capacitor)
import Capacitor
#endif

// Independent of AR capture or LiDAR. A detected object is a possible review
// concern, never a hazard finding, checklist answer, or home safety assessment.
private enum HazardError: Error { case invalidInput, missingResources, invalidModel, invalidImage }

private struct HazardIdentity: Codable {
    let version: Int
    let weightsSHA256: String
    let runtimeSHA256: String
}
private struct HazardModelInfo: Codable {
    let name: String
    let backend: String
    let engine: String
    let license: String
    let identity: HazardIdentity
    var dictionary: [String: Any] {
        ["name": name, "backend": backend, "engine": engine, "license": license,
         "identity": ["version": identity.version, "weightsSHA256": identity.weightsSHA256, "runtimeSHA256": identity.runtimeSHA256]]
    }
}
private struct HazardRuleItem: Codable { let checklistItemId: String; let threshold: Double }
private struct HazardGeometry: Codable {
    let minimumArea: Double
    let rugMinCenterY: Double
    let rugMinBottomY: Double
    let cordMinCenterY: Double
    let cordMinBottomY: Double
    let cordMinWidth: Double
    let cordMinAspect: Double
    let stairObjectOverlap: Double
    let bathCompanionConfidence: Double
    let floorClutterMinBottomY: Double
    let furnitureMinConfidence: Double
    let furnitureObjectOverlap: Double
}
private struct HazardConfig: Codable {
    let version: Int
    let model: HazardModelInfo
    let imageSize: Int
    let classes: [String]
    let classThresholds: [String: Double]
    let floorClutterThresholds: [String: Double]
    let items: [HazardRuleItem]
    let geometry: HazardGeometry
}

private struct HazardDetection {
    let label: String
    let confidence: Double
    // Normalized top-left coordinates, after clipping to the saved JPEG.
    let box: CGRect

    init?(label: String, confidence: Double, box: CGRect) {
        guard confidence.isFinite, confidence > 0, confidence <= 1,
              [box.minX, box.minY, box.width, box.height].allSatisfy({ $0.isFinite }),
              box.width > 0, box.height > 0 else { return nil }
        let clipped = box.intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        guard !clipped.isNull, clipped.width > 0, clipped.height > 0 else { return nil }
        self.label = label; self.confidence = confidence; self.box = clipped
    }

    var dictionary: [String: Any] {
        ["class": label, "confidence": confidence,
         "box": [Double(box.midX), Double(box.midY), Double(box.width), Double(box.height)]]
    }
}

/// Rules only propose visible objects. Lower-frame geometry is a heuristic,
/// not floor segmentation, depth, a walking-route estimate, or proof of risk.
private struct HazardRules {
    let config: HazardConfig
    func analyze(_ detections: [HazardDetection], width: Int, height: Int) -> [String: Any] {
        let g = config.geometry
        var results: [String: Any] = [:]
        var best: [String: Double] = [:]
        for item in config.items {
            results[item.checklistItemId] = ["relevance": 0.0, "point": NSNull()] as [String: Any]
        }
        func passes(_ d: HazardDetection) -> Bool {
            d.confidence >= (config.classThresholds[d.label] ?? 1)
        }
        func record(_ id: String, _ d: HazardDetection) {
            // The v1 bridge keeps its legacy relevance field. It now carries
            // detector confidence; it is not a calibrated hazard probability.
            let score = min(1 - 1e-12, d.confidence)
            guard let threshold = config.items.first(where: { $0.checklistItemId == id })?.threshold,
                  score >= threshold, score > (best[id] ?? 0) else { return }
            best[id] = score
            results[id] = ["relevance": score,
                           "point": ["u": Double(d.box.midX) * Double(width),
                                     "v": Double(d.box.midY) * Double(height)]] as [String: Any]
        }
        let ds = detections.filter { Double($0.box.width * $0.box.height) >= g.minimumArea }
        let rugs: Set<String> = ["rug", "floor mat", "runner rug"]
        let cords: Set<String> = ["electrical cord", "extension cord", "power strip"]
        let clutter: Set<String> = ["shoe", "bag", "cardboard box", "clothes", "toy", "book"]
        let furniture: Set<String> = ["table", "desk", "sofa", "chair", "bed", "cabinet", "kitchen counter", "kitchen island"]
        let supports = ds.filter { furniture.contains($0.label) && $0.confidence >= g.furnitureMinConfidence }
        for d in ds where passes(d) {
            if rugs.contains(d.label), Double(d.box.midY) >= g.rugMinCenterY, Double(d.box.maxY) >= g.rugMinBottomY {
                record("rug-check", d)
            }
            let aspect = Double(d.box.width) * Double(width) / (Double(d.box.height) * Double(height))
            if cords.contains(d.label), Double(d.box.midY) >= g.cordMinCenterY,
               Double(d.box.maxY) >= g.cordMinBottomY, Double(d.box.width) >= g.cordMinWidth, aspect >= g.cordMinAspect {
                record("cord-check", d)
            }
            if clutter.contains(d.label) {
                if d.confidence >= (config.floorClutterThresholds[d.label] ?? 1), Double(d.box.maxY) >= g.floorClutterMinBottomY {
                    let onFurniture = supports.contains { support in
                        // Keep objects extending to/below the furniture bottom:
                        // a floor object can project inside a table's full box.
                        guard d.box.maxY < support.box.maxY else { return false }
                        let overlap = d.box.intersection(support.box)
                        return !overlap.isNull && Double(overlap.width * overlap.height / (d.box.width * d.box.height)) >= g.furnitureObjectOverlap
                    }
                    if !onFurniture { record("floor-clutter-check", d) }
                }
                for stairs in ds where stairs.label == "stairs" && passes(stairs) {
                    let overlap = d.box.intersection(stairs.box)
                    if !overlap.isNull, Double(overlap.width * overlap.height / (d.box.width * d.box.height)) >= g.stairObjectOverlap {
                        record("stair-clutter-check", d)
                    }
                }
            }
        }
        // A low-confidence bar anywhere suppresses this prompt. Failure to
        // detect a bar is explicitly NOT proof that a bar is absent or needed.
        if !detections.contains(where: { $0.label == "grab bar" && passes($0) }) {
            for d in ds where passes(d) {
                var fixture = d.label == "toilet" || d.label == "shower"
                if d.label == "bathtub" {
                    // Tub-only detections confused kitchen islands and stairs
                    // during development review; require bathroom context.
                    fixture = ds.contains { ["toilet", "shower"].contains($0.label) && $0.confidence >= g.bathCompanionConfidence }
                }
                if fixture { record("bathroom-support-check", d) }
            }
        }
        // Lighting, shower grip and handrail stability
        // have no supported rule here and remain zero-score abstentions.
        return results
    }
}

private final class HazardEngine {
    let config: HazardConfig
    let visionModel: VNCoreMLModel

    convenience init(bundle: Bundle = .main) throws {
        // Retain existing resource names to avoid concurrent Xcode project edits.
        guard let json = bundle.url(forResource: "hazard-prompts", withExtension: "json"),
              let url = bundle.url(forResource: "HazardImageEncoder", withExtension: "mlmodelc") else { throw HazardError.missingResources }
        try self.init(modelURL: url, configData: Data(contentsOf: json))
    }

    init(modelURL: URL, configData: Data) throws {
        let config = try JSONDecoder().decode(HazardConfig.self, from: configData)
        self.config = config
        let ids = ["rug-check", "cord-check", "stair-clutter-check", "handrail-check", "stair-lighting-check",
                   "night-lighting-check", "shower-surface-check", "bathroom-support-check", "floor-clutter-check"]
        let abstain: Set<String> = ["handrail-check", "stair-lighting-check", "night-lighting-check", "shower-surface-check"]
        let g = config.geometry
        let unitValues = [g.minimumArea, g.rugMinCenterY, g.rugMinBottomY, g.cordMinCenterY,
                          g.cordMinBottomY, g.cordMinWidth, g.stairObjectOverlap, g.bathCompanionConfidence,
                          g.floorClutterMinBottomY, g.furnitureMinConfidence, g.furnitureObjectOverlap]
        let sha: (String) -> Bool = { $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }
        guard config.version == 2, config.imageSize == 640, config.model.backend == "coreml",
              config.model.engine == "yolo-world-object-rules", config.model.license == "AGPL-3.0 weights and runtime",
              config.model.identity.version == 1, sha(config.model.identity.weightsSHA256), sha(config.model.identity.runtimeSHA256),
              config.items.map(\.checklistItemId) == ids, config.classes.count >= 17,
              Set(config.classes).count == config.classes.count,
              config.items.allSatisfy({ $0.threshold.isFinite && (0...1).contains($0.threshold) && (!abstain.contains($0.checklistItemId) || $0.threshold == 1) }),
              config.classThresholds.allSatisfy({ config.classes.contains($0.key) && $0.value.isFinite && $0.value > 0 && $0.value < 1 }),
              Set(config.floorClutterThresholds.keys) == Set(["shoe", "bag", "cardboard box", "clothes", "toy", "book"]),
              config.floorClutterThresholds.allSatisfy({ config.classes.contains($0.key) && $0.value.isFinite && $0.value >= (config.classThresholds[$0.key] ?? 1) && $0.value < 1 }),
              unitValues.allSatisfy({ $0.isFinite && (0...1).contains($0) }), g.minimumArea > 0,
              g.cordMinAspect.isFinite, (1...10).contains(g.cordMinAspect) else { throw HazardError.invalidModel }
        let options = MLModelConfiguration(); options.computeUnits = .all
        let model = try MLModel(contentsOf: modelURL, configuration: options)
        guard let input = model.modelDescription.inputDescriptionsByName["image"]?.imageConstraint,
              input.pixelsWide == config.imageSize, input.pixelsHigh == config.imageSize,
              Set(model.modelDescription.outputDescriptionsByName.keys) == Set(["confidence", "coordinates"]) else { throw HazardError.invalidModel }
        visionModel = try VNCoreMLModel(for: model)
    }

    func detect(jpeg: Data) throws -> (Int, Int, [HazardDetection]) {
        guard let source = CGImageSourceCreateWithData(jpeg as CFData, nil),
              CGImageSourceGetType(source) as String? == "public.jpeg",
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              (1...1600).contains(width), (1...1600).contains(height),
              (properties[kCGImagePropertyOrientation] as? Int ?? 1) == 1,
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw HazardError.invalidImage }
        let request = VNCoreMLRequest(model: visionModel)
        // Match Python's full-image 640x640 resize. Vision returns boxes in the
        // original image's normalized space, with a lower-left origin.
        request.imageCropAndScaleOption = .scaleFill
        try VNImageRequestHandler(cgImage: image, orientation: .up, options: [:]).perform([request])
        guard let observations = request.results as? [VNRecognizedObjectObservation] else { throw HazardError.invalidModel }
        let detections = observations.compactMap { observation -> HazardDetection? in
            guard let label = observation.labels.first, config.classes.contains(label.identifier) else { return nil }
            let box = observation.boundingBox
            // Vision separates object confidence from conditional class
            // confidence. Multiply them to recover the NMS detector score.
            return HazardDetection(label: label.identifier, confidence: Double(observation.confidence) * Double(label.confidence),
                                   box: CGRect(x: box.minX, y: 1 - box.maxY, width: box.width, height: box.height))
        }
        return (width, height, detections)
    }

    func analyze(jpeg: Data) throws -> [String: Any] {
        let (width, height, detections) = try detect(jpeg: jpeg)
        return HazardRules(config: config).analyze(detections, width: width, height: height)
    }
}

#if canImport(Capacitor)
@objc(FixListHazardsPlugin)
public class FixListHazardsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FixListHazardsPlugin"
    public let jsName = "FixListHazards"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "analyze", returnType: CAPPluginReturnPromise)
    ]
    private let queue = DispatchQueue(label: "app.fixlist.hazards", qos: .userInitiated)
    private var engine: HazardEngine?
    private let lock = NSLock()
    private var analyzing = false

    private func loadedEngine() throws -> HazardEngine {
        if let engine = engine { return engine }
        let result = try HazardEngine(); engine = result; return result
    }

    @objc func availability(_ call: CAPPluginCall) {
        queue.async {
            do { let engine = try self.loadedEngine(); call.resolve(["available": true, "model": engine.config.model.dictionary]) }
            catch { call.resolve(["available": false, "reason": "The on-device photo model is unavailable."]) }
        }
    }

    @objc func analyze(_ call: CAPPluginCall) {
        guard let photos = call.getArray("photos", JSObject.self), (1...40).contains(photos.count) else {
            call.reject("Expected 1 to 40 room photos.", "INVALID_INPUT"); return
        }
        // Snapshot small input metadata before dispatch; never log photo bytes.
        var inputs: [(String, String)] = [], ids = Set<String>(), encodedBytes = 0
        for photo in photos {
            guard Set(photo.keys) == Set(["photoId", "jpegBase64"]), let id = photo["photoId"] as? String,
                  id.range(of: "^p[0-9]{2,3}$", options: .regularExpression) != nil, ids.insert(id).inserted,
                  let jpeg = photo["jpegBase64"] as? String, !jpeg.isEmpty, jpeg.utf8.count <= 12 * 1024 * 1024 else {
                call.reject("Invalid or duplicate room photo.", "INVALID_INPUT"); return
            }
            encodedBytes += jpeg.utf8.count
            guard encodedBytes <= 64 * 1024 * 1024 else { call.reject("Room photos exceed the analysis batch limit.", "INVALID_INPUT"); return }
            inputs.append((id, jpeg))
        }
        lock.lock()
        if analyzing { lock.unlock(); call.reject("A room photo check is already running.", "BUSY"); return }
        analyzing = true; lock.unlock()
        queue.async {
            defer { self.lock.lock(); self.analyzing = false; self.lock.unlock() }
            do {
                let engine = try self.loadedEngine()
                var rows: [[String: Any]] = []
                for (id, encoded) in inputs {
                    let items = try autoreleasepool { () throws -> [String: Any] in
                        guard let jpeg = Data(base64Encoded: encoded) else { throw HazardError.invalidInput }
                        return try engine.analyze(jpeg: jpeg)
                    }
                    rows.append(["photoId": id, "items": items])
                }
                call.resolve(["model": engine.config.model.dictionary, "photos": rows])
            } catch { call.reject("The on-device photo check could not finish. Your photos are still on this device.", "ANALYSIS_FAILED") }
        }
    }
}
#endif
