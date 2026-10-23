import Foundation
import CoreML
import CoreGraphics
import CoreVideo
import ImageIO
#if canImport(Capacitor)
import Capacitor
#endif

// Independent of AR capture. These are relevance scores and approximate photo
// spots, never a condition classifier, checklist answer or home assessment.
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
private struct HazardPromptItem: Codable {
    let checklistItemId: String
    let positiveIndices: [Int]
    let threshold: Double
}
private struct HazardPrompts: Codable {
    let version: Int
    let model: HazardModelInfo
    let inputName: String
    let outputName: String
    let imageSize: Int
    let interpolation: String
    let cropFraction: Double
    let logitScale: Double
    let neutralIndices: [Int]
    let textEmbeddings: [[Double]]
    let items: [HazardPromptItem]
}

/// RGB byte resampling matches Pillow's separable antialiased BILINEAR/BICUBIC
/// kernels and 22-bit coefficient rounding; torchvision shortest-edge sizing
/// and centre-crop use truncation and ties-to-even respectively.
private struct HazardRGB {
    let width: Int
    let height: Int
    let bytes: [UInt8]

    init(jpeg: Data) throws {
        guard let source = CGImageSourceCreateWithData(jpeg as CFData, nil),
              CGImageSourceGetType(source) as String? == "public.jpeg",
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let w = properties[kCGImagePropertyPixelWidth] as? Int,
              let h = properties[kCGImagePropertyPixelHeight] as? Int,
              (1...1600).contains(w), (1...1600).contains(h),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw HazardError.invalidImage }
        var rgba = [UInt8](repeating: 0, count: w * h * 4)
        let ok = rgba.withUnsafeMutableBytes { pointer -> Bool in
            guard let space = CGColorSpace(name: CGColorSpace.sRGB),
                  let context = CGContext(data: pointer.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                    space: space, bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard ok else { throw HazardError.invalidImage }
        var rgb = [UInt8](repeating: 0, count: w * h * 3)
        for i in 0..<(w * h) { for c in 0..<3 { rgb[i * 3 + c] = rgba[i * 4 + c] } }
        width = w; height = h; bytes = rgb
    }

    init(width: Int, height: Int, bytes: [UInt8]) { self.width = width; self.height = height; self.bytes = bytes }

    private static func coefficients(_ input: Int, _ output: Int, _ interpolation: String) -> [(Int, [Int64])] {
        let scale = Double(input) / Double(output), filterScale = max(1, scale)
        let support = (interpolation == "bilinear" ? 1.0 : 2.0) * filterScale
        return (0..<output).map { i in
            let centre = (Double(i) + 0.5) * scale
            let start = max(0, Int(centre - support + 0.5)), end = min(input, Int(centre + support + 0.5))
            var weights: [Double] = []
            for j in start..<end {
                let x = abs((Double(j) - centre + 0.5) / filterScale)
                let weight: Double
                if interpolation == "bilinear" { weight = max(0, 1 - x) }
                else if x < 1 { weight = ((1.5 * x - 2.5) * x) * x + 1 }
                else if x < 2 { weight = ((-0.5 * x + 2.5) * x - 4) * x + 2 }
                else { weight = 0 }
                weights.append(weight)
            }
            let total = weights.reduce(0, +)
            return (start, weights.map { weight in
                let value = weight / total * Double(1 << 22)
                return Int64(value < 0 ? value - 0.5 : value + 0.5)
            })
        }
    }

    func prepared(edge: Int, interpolation: String, crop: (Int, Int, Int, Int)? = nil) -> HazardRGB {
        let (left, top, cw, ch) = crop ?? (0, 0, width, height)
        let rw = cw <= ch ? edge : Int(Double(edge) * Double(cw) / Double(ch))
        let rh = ch <= cw ? edge : Int(Double(edge) * Double(ch) / Double(cw))
        let xs = Self.coefficients(cw, rw, interpolation), ys = Self.coefficients(ch, rh, interpolation)
        var horizontal = [UInt8](repeating: 0, count: rw * ch * 3)
        for y in 0..<ch { for x in 0..<rw { for c in 0..<3 {
            var sum: Int64 = 1 << 21
            let (start, taps) = xs[x]
            if cw == rw { horizontal[(y * rw + x) * 3 + c] = bytes[((top + y) * width + left + x) * 3 + c]; continue }
            for (k, tap) in taps.enumerated() { sum += Int64(bytes[((top + y) * width + left + start + k) * 3 + c]) * tap }
            horizontal[(y * rw + x) * 3 + c] = UInt8(clamping: sum >> 22)
        } } }
        let ox = Int((Double(rw - edge) / 2).rounded(.toNearestOrEven))
        let oy = Int((Double(rh - edge) / 2).rounded(.toNearestOrEven))
        var output = [UInt8](repeating: 0, count: edge * edge * 3)
        for y in 0..<edge { for x in 0..<edge { for c in 0..<3 {
            var sum: Int64 = 1 << 21
            if ch == rh { output[(y * edge + x) * 3 + c] = horizontal[((y + oy) * rw + x + ox) * 3 + c]; continue }
            let (start, taps) = ys[y + oy]
            for (k, tap) in taps.enumerated() { sum += Int64(horizontal[((start + k) * rw + x + ox) * 3 + c]) * tap }
            output[(y * edge + x) * 3 + c] = UInt8(clamping: sum >> 22)
        } } }
        return HazardRGB(width: edge, height: edge, bytes: output)
    }

    func pixelBuffer() throws -> CVPixelBuffer {
        var result: CVPixelBuffer?
        guard CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, nil, &result) == kCVReturnSuccess,
              let buffer = result else { throw HazardError.invalidImage }
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { throw HazardError.invalidImage }
        let stride = CVPixelBufferGetBytesPerRow(buffer), pointer = base.assumingMemoryBound(to: UInt8.self)
        for y in 0..<height { for x in 0..<width {
            let source = (y * width + x) * 3, target = y * stride + x * 4
            pointer[target] = bytes[source + 2]; pointer[target + 1] = bytes[source + 1]
            pointer[target + 2] = bytes[source]; pointer[target + 3] = 255
        } }
        return buffer
    }
}

private final class HazardEngine {
    let prompts: HazardPrompts
    let model: MLModel

    init(bundle: Bundle = .main) throws {
        guard let json = bundle.url(forResource: "hazard-prompts", withExtension: "json"),
              let url = bundle.url(forResource: "HazardImageEncoder", withExtension: "mlmodelc") else { throw HazardError.missingResources }
        prompts = try JSONDecoder().decode(HazardPrompts.self, from: Data(contentsOf: json))
        guard prompts.version == 1, prompts.model.backend == "coreml", prompts.model.engine == "clip-zero-shot",
              [224, 256].contains(prompts.imageSize), ["bilinear", "bicubic"].contains(prompts.interpolation),
              prompts.cropFraction == 0.6, prompts.logitScale.isFinite, prompts.logitScale > 0,
              prompts.items.count == 8, Set(prompts.items.map(\.checklistItemId)).count == 8,
              !prompts.textEmbeddings.isEmpty, !prompts.neutralIndices.isEmpty else { throw HazardError.invalidModel }
        for vector in prompts.textEmbeddings {
            guard vector.count == 512, vector.allSatisfy(\.isFinite),
                  abs(vector.reduce(0) { $0 + $1 * $1 } - 1) < 0.001 else { throw HazardError.invalidModel }
        }
        let vectorIndices = prompts.textEmbeddings.indices
        let validIndex: (Int) -> Bool = { vectorIndices.contains($0) }
        guard prompts.neutralIndices.allSatisfy(validIndex), prompts.items.allSatisfy({
            !$0.positiveIndices.isEmpty && $0.positiveIndices.allSatisfy(validIndex) && $0.threshold.isFinite && (0...1).contains($0.threshold)
        }) else { throw HazardError.invalidModel }
        let configuration = MLModelConfiguration(); configuration.computeUnits = .all
        model = try MLModel(contentsOf: url, configuration: configuration)
    }

    private func embedding(_ rgb: HazardRGB) throws -> [Double] {
        let input = try MLDictionaryFeatureProvider(dictionary: [prompts.inputName: MLFeatureValue(pixelBuffer: rgb.pixelBuffer())])
        let prediction = try model.prediction(from: input)
        guard let values = prediction.featureValue(for: prompts.outputName)?.multiArrayValue, values.count == 512 else { throw HazardError.invalidModel }
        var vector = (0..<values.count).map { values[$0].doubleValue }
        let norm = sqrt(vector.reduce(0) { $0 + $1 * $1 })
        guard norm.isFinite, norm > 0 else { throw HazardError.invalidModel }
        for i in vector.indices { vector[i] /= norm }
        return vector
    }

    func analyze(jpeg: Data) throws -> [String: Any] {
        let image = try HazardRGB(jpeg: jpeg), edge = prompts.imageSize
        var scores = [[Double]](repeating: [], count: prompts.items.count)
        let cw = max(1, Int(Double(image.width) * prompts.cropFraction)), ch = max(1, Int(Double(image.height) * prompts.cropFraction))
        for view in 0..<10 {
            try autoreleasepool {
                let crop: (Int, Int, Int, Int)?
                if view == 0 { crop = nil }
                else { let cell = view - 1; crop = (Int(Double(cell % 3 * (image.width - cw)) / 2), Int(Double(cell / 3 * (image.height - ch)) / 2), cw, ch) }
                let vector = try embedding(image.prepared(edge: edge, interpolation: prompts.interpolation, crop: crop))
                let similarities = prompts.textEmbeddings.map { text in zip(vector, text).reduce(0) { $0 + $1.0 * $1.1 } }
                let neutral = prompts.neutralIndices.reduce(0) { $0 + similarities[$1] } / Double(prompts.neutralIndices.count)
                for (i, item) in prompts.items.enumerated() {
                    let positive = item.positiveIndices.reduce(0) { $0 + similarities[$1] } / Double(item.positiveIndices.count)
                    let logit = min(80, max(-80, prompts.logitScale * (positive - neutral)))
                    // Endpoint clamp makes a threshold of 1 an explicit abstention.
                    scores[i].append(min(1 - 1e-12, max(1e-12, 1 / (1 + exp(-logit)))))
                }
            }
        }
        var items: [String: Any] = [:]
        for (i, item) in prompts.items.enumerated() {
            let values = scores[i], best = values.max() ?? 0
            var point: Any = NSNull()
            // Conservative localization is a coarse grid aid. Full-image-only
            // evidence, diffuse crops, or a high none score stays photo-only.
            let cropScores = Array(values.dropFirst())
            let logits = cropScores.map { log($0 / (1 - $0)) }, maxLogit = logits.max() ?? 0
            let masses = logits.map { exp($0 - maxLogit) }, total = masses.reduce(0, +)
            let normalized = masses.map { $0 / total }, sorted = normalized.sorted(by: >)
            if let winner = normalized.firstIndex(of: sorted[0]), best >= item.threshold, best >= 0.7,
               cropScores[winner] >= values[0], sorted[0] >= 0.6, sorted[0] - sorted[1] >= 0.25, 1 - values[0] < 0.2 {
                point = ["u": (Double(winner % 3) + 0.5) * Double(image.width) / 3,
                         "v": (Double(winner / 3) + 0.5) * Double(image.height) / 3]
            }
            items[item.checklistItemId] = ["relevance": best, "point": point]
        }
        return items
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
            do { let engine = try self.loadedEngine(); call.resolve(["available": true, "model": engine.prompts.model.dictionary]) }
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
                call.resolve(["model": engine.prompts.model.dictionary, "photos": rows])
            } catch { call.reject("The on-device photo check could not finish. Your photos are still on this device.", "ANALYSIS_FAILED") }
        }
    }
}
#endif
