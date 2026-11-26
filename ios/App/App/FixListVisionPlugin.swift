import Foundation
import CoreGraphics
import ImageIO
import CoreImage
import MLX
import MLXLMCommon
import MLXVLM
import CryptoKit
#if canImport(UIKit)
import UIKit
import Capacitor
import WebKit
import os
#endif

// Pure helpers below are compiled unchanged by scan/vision/test_native.py.
enum FixListVisionContract {
    static let prompt = """
You are a home fall-safety inspector. Inspect the photo carefully. Find every visible problem, not just the largest object. Start with small objects and cables on the FLOOR, then stairs, rugs, and bathroom safety. Give 0 to 6 findings. Use an empty list for clear rooms.
Report floor toys/clutter/bags/clothes/shoes/boxes, cords across walking floors, small loose rugs, cluttered stairs, missing handrails, no grab bar beside a clearly visible toilet/tub, bare visible shower floor, dark paths, blocked exits, low/glass/sharp furniture obstructing a path, or visible fire/reach hazards. Ordinary chairs/tables/beds/toilets, open doors/windows, wall outlets and hanging towels are NOT problems. Do not invent wetness, instability, bad wiring, or hidden/missing equipment. A rug's backing cannot be determined from a photo.
JSON only: {"hazards":[{"label":"short name","detail":"visible problem and exact location","tip":"one concrete fix","category":"trip","severity":"medium","box":null}]}
category MUST be one of: trip (floor clutter/cables), slip (loose rugs/bare shower), stairs, bathroom (grab bars), lighting, furniture (path collision), fire, reach, other. severity MUST be medium for ordinary fall concerns, high for cluttered stairs/fire, or low for minor issues. box is null unless confident: [xmin,ymin,xmax,ymax], integers 0..1000. No speculation.
Example toys + rug: {"hazards":[{"label":"Toys on floor","detail":"Small toys lie on the floor to the left of the sofa.","tip":"Store toys in a bin off the walking path.","category":"trip","severity":"medium","box":null},{"label":"Throw rug in path","detail":"A small throw rug lies across the doorway.","tip":"Remove it or secure it with non-slip backing.","category":"slip","severity":"medium","box":null}]}
Example bathroom: {"hazards":[{"label":"No toilet grab bar visible","detail":"No grab bar is visible on the exposed wall beside the toilet.","tip":"Have an anchored grab bar installed beside the toilet.","category":"bathroom","severity":"medium","box":null}]}
Example clear room with normal furniture: {"hazards":[]}
Now inspect THIS image. List its visible hazards with specific locations and practical fixes. Do not copy the examples.
"""
    static let scenePrompt = """
What does this photo visibly show? Reply with exactly one word: bathroom (a toilet, bathtub or shower is visible), stairs (stairs are visible but no bathroom), room (a walking floor is visible), or closeup (none of those are visible). Describe only the photo, not objects outside it.
"""
    static let bathroomPrompt = """
Review visible bathroom fall-safety concerns. Inspect the bathtub/shower, toilet and floor. Report ALL distinct concerns, up to 4. Ignore towels on racks and normal fixtures. Do not invent floor objects, wetness, hidden surfaces or faulty wiring.
If the exposed wall beside a visible toilet/tub lacks a grab bar, say no grab bar is VISIBLE there. Name only a fixture actually visible in the photo. A towel rack is not a grab bar. If the tub/shower's interior floor is clearly visible without a non-slip mat/strips, report that visible surface; do not assume it is wet or lacks built-in texture. Also report actual floor clutter, cords and loose/bunched mats.
JSON only: {"hazards":[{"label":"short name","detail":"visible evidence with specific location","tip":"one concrete fix","category":"bathroom","severity":"medium","confidence":"high","box":null}]}. category: bathroom for grab bars; slip for mats/bare bathing surfaces; trip for floor clutter/cords. Use severity medium for fall concerns. Omit uncertain findings. box:null. Each condition only once. detail and tip each <=200 characters.
Example visible tub wall: {"hazards":[{"label":"No tub grab bar visible","detail":"No grab bar is visible on the exposed wall alongside the bathtub.","tip":"Have a properly anchored grab bar installed beside the tub.","category":"bathroom","severity":"medium","confidence":"high","box":null}]}
Example clear supported bathroom: {"hazards":[]}
Return this photo's findings only. Never copy a fixture that is absent.
"""
    static let categories: Set<String> = ["trip", "slip", "lighting", "stairs", "bathroom", "fire", "reach", "furniture", "other"]

    static func parse(_ text: String, scene: VisionScene? = nil) throws -> [VisionHazard] {
        var raw = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.hasPrefix("```json\n"), raw.hasSuffix("```") {
            raw = String(raw.dropFirst(8).dropLast(3)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard raw.utf8.count <= 32_000, let data = raw.data(using: .utf8) else {
            throw VisionFailure.message("The vision model returned incomplete or invalid JSON. Please try another photo.")
        }
        let root = try JSONSerialization.jsonObject(with: data)
        // Some small-model responses use a bare array. The public plugin still
        // always returns the fixed { hazards: [...] } response with validated items.
        guard let items = (root as? [String: Any])?["hazards"] as? [Any] ?? root as? [Any] else {
            throw VisionFailure.message("The vision model returned incomplete or invalid JSON. Please try another photo.")
        }
        var seen = Set<String>()
        return items.compactMap { value -> VisionHazard? in
            guard let item=value as? [String:Any] else { return nil }
            func string(_ key: String, max: Int) -> String? {
                guard let value = item[key] as? String else { return nil }
                let s = value.trimmingCharacters(in: .whitespacesAndNewlines)
                return !s.isEmpty && s.count <= max && !s.unicodeScalars.contains(where: { $0.value < 32 }) ? s : nil
            }
            guard let label = string("label", max: 60), let detail = string("detail", max: 240),
                  let tip = string("tip", max: 240), let category = item["category"] as? String,
                  categories.contains(category), let severity = item["severity"] as? String,
                  ["high", "medium", "low"].contains(severity) else { return nil }
            if let confidence = item["confidence"] {
                guard let c = confidence as? String, c == "high" else { return nil }
            }
            guard let finding = grounded(label: label, detail: detail, tip: tip,
                                         category: category, severity: severity, scene: scene) else { return nil }
            let key = label.lowercased()+"|"+detail.lowercased()
            // Omitted localization is explicitly represented as null, never a guessed rectangle.
            let boxValue = item["box"] ?? NSNull()
            var box: VisionBox?
            if !(boxValue is NSNull) {
                if let b = boxValue as? [String: Any],
                      let x = number(b["x"]), let y = number(b["y"]),
                      let w = number(b["w"]), let h = number(b["h"]),
                      x >= 0, y >= 0, w > 0, h > 0, x + w <= 1.000001, y + h <= 1.000001 {
                    box = VisionBox(x: x, y: y, w: min(w, 1-x), h: min(h, 1-y))
                } else if let values=boxValue as? [Any], values.count==4 {
                    // Qwen3-VL's explicitly requested native 0...1000 xyxy convention.
                    let b=values.compactMap(number)
                    guard b.count==4, b.allSatisfy({ $0>=0 && $0<=1000 && $0.rounded()==$0 }),
                          b[2]>b[0], b[3]>b[1] else { return nil }
                    box=VisionBox(x:b[0]/1000,y:b[1]/1000,w:(b[2]-b[0])/1000,h:(b[3]-b[1])/1000)
                } else { return nil }
            }
            if finding.category == "trip", ["cord", "cable", "wire"].contains(where: { (label+" "+detail).lowercased().contains($0) }), let box {
                // At the 448 px input budget, a minute patch is insufficient
                // evidence for a cable. A claimed floor cable spanning almost
                // the full image height from its top is also poorly grounded.
                // Conservative rejection can miss real cords; this is not a
                // geometric proof of the floor or a calibrated confidence score.
                guard hypot(box.w, box.h) >= 0.06, !(box.y < 0.05 && box.h > 0.85) else { return nil }
            }
            guard seen.insert(key).inserted else { return nil }
            return VisionHazard(label: finding.label, detail: detail, tip: finding.tip, category: finding.category, severity: finding.severity, box: box)
        }.prefix(8).map { $0 }
    }

    // Used only to bound a local generation, never to invent an unfinished
    // object. Every returned item must be a complete, parseable JSON object.
    static func completePrefix(_ text: String) -> [[String: Any]]? {
        var raw = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.hasPrefix("```json\n") { raw = String(raw.dropFirst(8)) }
        else if raw.hasPrefix("```\n") { raw = String(raw.dropFirst(4)) }
        let bare = raw.hasPrefix("[")
        guard bare || raw.range(of: #"^\{\s*"hazards"\s*:\s*\["#, options: .regularExpression) != nil else { return nil }
        var depth = 0, quoted = false, escaped = false
        var completed: [[String: Any]]?
        for i in raw.indices {
            let c = raw[i]
            if quoted {
                if escaped { escaped = false }
                else if c == "\\" { escaped = true }
                else if c == "\"" { quoted = false }
                continue
            }
            if c == "\"" { quoted = true; continue }
            if c == "{" { depth += 1 }
            if c == "}" {
                depth -= 1
                if depth == (bare ? 0 : 1) {
                    let candidate = String(raw[...i])+(bare ? "]" : "]}")
                    if let data = candidate.data(using: .utf8), let root = try? JSONSerialization.jsonObject(with: data),
                       let items = (root as? [String: Any])?["hazards"] as? [[String: Any]] ?? root as? [[String: Any]] {
                        completed = items
                    }
                }
            }
        }
        return completed
    }
    static func shouldBound(_ items: [[String: Any]]) -> Bool {
        if items.count >= 4 { return true }
        var seen = Set<String>()
        for item in items {
            guard let label = item["label"] as? String, let detail = item["detail"] as? String else { continue }
            if !seen.insert(label.lowercased()+"|"+detail.lowercased()).inserted { return true }
        }
        return false
    }
    static func canonicalResponse(_ items: [[String: Any]]) throws -> String {
        String(decoding: try JSONSerialization.data(withJSONObject: ["hazards": Array(items.prefix(4))]), as: UTF8.self)
    }

    // These checks reject unsupported language; they do not establish that an
    // object exists. Scene classification and model confidence are fallible.
    static func grounded(label: String, detail: String, tip: String, category: String,
                         severity: String, scene: VisionScene?) -> (label: String, tip: String, category: String, severity: String)? {
        let d = detail.lowercased().replacingOccurrences(of: "_", with: " ")
        let text = label.lowercased()+" "+d
        func has(_ words: [String], in value: String = "") -> Bool {
            let source = value.isEmpty ? d : value
            return words.contains { source.contains($0) }
        }
        guard !has(["possibly", "if unstable", "if it", "if the", "could be", "may be", "appears to", "partially visible", "not properly grounded"]),
              has(["floor", "path", "walkway", "stairs", "step", "wall", "beside", "alongside", "near", "left", "right", "front", "behind", "under", "above", "corner", "shelf", "shelves", "doorway", "exit"]) else { return nil }
        var c = category, level = severity, name = label, action = tip
        let cord = has(["cord", "cable", "wire"], in: text)
        let rug = has(["rug", "mat", "carpet"], in: text)
        let grab = has(["grab bar", "grab-bar"], in: text)
        let obstruction = has(["blocking", "blocked", "obstruct", "projects", "projecting", "protrud"]) && has(["path", "walkway", "exit", "doorway"])
        let floorObject = has(["toy", "shoe", "bag", "box", "boxes", "cloth", "towel", "blanket", "paper", "clutter", "object", "items", "bowl", "pet bed"], in: d)
        let onFloor = has(["floor", "walking path", "walkway", "stairs", "steps", "stair tread", "crosses the path"])
        // A curtain hanging in its doorway is ordinary furnishing. It needs
        // floor entanglement or a genuinely blocked exit, not a generic risk.
        if c != "fire", has(["curtain"], in: text) && !has(["tangled", "trailing on", "piled on", "blocks the exit", "blocked exit"]) { return nil }
        if scene != nil && scene != .bathroom && (c == "bathroom" || grab) { return nil }
        // A wall/fixture close-up cannot support a claim about a floor cord.
        if scene == .closeup && (c == "trip" || c == "stairs") { return nil }
        if grab {
            guard has(["toilet", "tub", "shower"]), has(["wall"]), has(["no ", "without", "missing", "lacks"]) else { return nil }
            c = "bathroom"; level = "medium"; name = "No grab bar visible"
            let fixture = has(["toilet"]) ? "the toilet" : "the tub or shower"
            action = "Have a properly anchored grab bar installed beside "+fixture+"."
        } else if c == "bathroom" {
            guard scene == .bathroom, has(["mat", "non-slip", "nonslip"]), has(["floor", "surface"]), has(["bare", "no ", "without", "lacks"]) else { return nil }
            c = "slip"; level = "medium"
            action = has(["near the", "beside the", "outside"]) ? "Place a slip-resistant bath mat beside the tub or shower." : "Add a non-slip bath mat or self-stick strips inside the tub or shower."
        } else if c == "trip" || (c == "furniture" && onFloor && (cord || floorObject)) {
            guard onFloor, cord || floorObject || obstruction,
                  !has(["inside the bag", "inside a bag", "inside the black", "on the table", "on a table", "on the bed", "on the sofa"]) else { return nil }
            c = "trip"; level = "medium"
            action = cord ? "Route cords along the wall, away from walking areas; secure them with cable clips." : "Pick up these items and store them off the walking path."
            if d.range(of: #"\bon (?:the |a )?(?:\w+ )?(?:stairs|steps?|stair tread)\b"#, options: .regularExpression) != nil {
                c = "stairs"; level = "high"; action = "Remove all objects from the steps and landings; keep the stairs clear."
            }
        } else if c == "slip", scene == .bathroom, has(["tub", "shower"]), has(["floor", "surface"]), has(["bare", "no ", "without", "lacks"]) {
            level = "medium"; action = "Add a non-slip bath mat or self-stick strips inside the tub or shower."
        } else if c == "slip" && rug {
            // A plain patch of fitted carpet, blanket or hypothetical loose
            // backing is not visible evidence of a hazardous throw rug.
            guard has(["rolled", "folded", "bunched", "curled", "wrinkled", "raised edge", "across the doorway", "across the path", "in the doorway"]),
                  !has(["on the bed", "on the sofa", "fitted carpet"]) else { return nil }
            level = "medium"
            action = "Remove the mat or rug, or lay it flat and secure it with non-slip backing."
        } else if c == "slip" {
            guard has(["wet", "water", "liquid", "puddle"]) else { return nil }
            level = "medium"; action = "Dry the floor and fix the source of the water; keep the walking area dry."
        } else if c == "lighting" {
            guard has(["dark", "dim", "unlit"]) else { return nil }
            level = "medium"; action = "Add a reachable light or night-light so the walking path is visible."
        } else if c == "stairs" {
            guard has(["stair", "step"]), has(["clutter", "pallet", "box", "items", "objects", "paper", "toy", "missing", "no handrail", "without a handrail", "broken", "uneven", "dark"]) else { return nil }
            if has(["clutter", "pallet", "box", "items", "objects", "paper", "toy"]) {
                level = "high"; action = "Remove all objects from the steps and landings; keep the stairs clear."
            } else if has(["handrail", "railing"]) {
                level = "medium"; action = "Have secure handrails installed along both sides of the stairs."
            }
        } else if c == "furniture" {
            guard obstruction || (has(["low", "glass", "sharp"]) && has(["walking path", "walkway", "shin"])) else { return nil }
            level = "medium"; action = "Move the furniture out of the walking path; pad exposed sharp corners if needed."
        } else if c == "reach" {
            guard has(["high", "shelf", "shelves", "stool", "ladder", "climb"]) else { return nil }
            level = "medium"
            action = has(["path", "walkway"]) ? "Store the stool or ladder off the walking path." : "Store frequently used items at waist height; use a sturdy step stool with a handhold when needed."
        } else if c == "fire" {
            let damaged = has(["frayed", "scorch", "burn", "melt", "exposed wire"])
            let heatNearFabric = has(["heater", "candle", "flame"]) && has(["fabric", "curtain", "bedding", "blanket", "clothes", "upholster"])
            guard damaged || heatNearFabric else { return nil }
            level = heatNearFabric ? "high" : "medium"
            action = heatNearFabric ? "Move heat and flame sources away from fabric and bedding." : "Stop using damaged electrical equipment; have its wiring repaired or replaced by a qualified electrician."
        } else if has(["outlet", "window", "door", "towel", "chair", "table", "bed", "toilet", "speaker"], in: text) {
            // Ordinary fixtures require a named visible defect or obstruction.
            guard obstruction || has(["frayed", "scorch", "burn", "melt", "exposed wire", "broken glass", "unguarded", "heater", "candle", "flame"]) else { return nil }
        }
        if label.lowercased() == "short name" {
            name = c == "slip" ? "Mat or rug on floor" : c == "trip" ? "Items on floor" : "Visible safety concern"
        }
        return (name, action, c, level)
    }

    static func number(_ value: Any?) -> Double? {
        guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(), n.doubleValue.isFinite else { return nil }
        return n.doubleValue
    }
}

enum VisionScene: String, Sendable { case bathroom, stairs, room, closeup }

enum VisionFailure: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let s) = self { return s }; return nil }
}

struct VisionBox: Sendable {
    let x: Double, y: Double, w: Double, h: Double
    var dictionary: [String: Double] { ["x": x, "y": y, "w": w, "h": h] }
}

struct VisionHazard: Sendable {
    let label: String, detail: String, tip: String, category: String, severity: String
    let box: VisionBox?
    var direction: SIMD3<Double>?
    var thumbnail: String?
    var dictionary: [String: Any] {
        ["label": label, "detail": detail, "tip": tip, "category": category, "severity": severity,
         "box": box?.dictionary as Any? ?? NSNull(),
         "direction": direction.map { [$0.x, $0.y, $0.z] } as Any? ?? NSNull(),
         "thumbnail": thumbnail as Any? ?? NSNull()]
    }
}

enum VisionProjection {
    static func unit(_ v: SIMD3<Double>) -> SIMD3<Double> { v / sqrt(v.x*v.x + v.y*v.y + v.z*v.z) }
    // Camera right, up and forward. Yaw increases toward +X; negative pitch looks down.
    static func basis(yaw: Double, pitch: Double) -> (SIMD3<Double>, SIMD3<Double>, SIMD3<Double>) {
        let y = yaw * .pi / 180, p = pitch * .pi / 180
        return (SIMD3(cos(y), 0, sin(y)), SIMD3(-sin(y)*sin(p), cos(p), cos(y)*sin(p)),
                SIMD3(sin(y)*cos(p), sin(p), -cos(y)*cos(p)))
    }
    static func direction(x: Double, y: Double, yaw: Double, pitch: Double = -20) -> SIMD3<Double> {
        let (r,u,f) = basis(yaw: yaw, pitch: pitch)
        return unit(f + r*(2*x-1) + u*(1-2*y)) // tan(90 degrees / 2) = 1
    }
    static func cropPoint(_ d: SIMD3<Double>, yaw: Double, pitch: Double = -20) -> SIMD2<Double>? {
        let (r,u,f) = basis(yaw: yaw, pitch: pitch)
        func dot(_ a: SIMD3<Double>, _ b: SIMD3<Double>) -> Double { a.x*b.x+a.y*b.y+a.z*b.z }
        let z = dot(d,f)
        guard z > 0 else { return nil }
        return SIMD2((dot(d,r)/z+1)/2, (1-dot(d,u)/z)/2)
    }
    static func equirectPoint(_ d: SIMD3<Double>) -> SIMD2<Double> {
        let v = unit(d)
        var u = atan2(v.x, -v.z) / (2 * .pi) + 0.5
        u -= floor(u)
        return SIMD2(u, 0.5 - asin(max(-1,min(1,v.y))) / .pi)
    }
    static func equirectDirection(u: Double, v: Double) -> SIMD3<Double> {
        let l=(u-0.5)*2 * .pi, p=(0.5-v) * .pi
        return SIMD3(sin(l)*cos(p),sin(p),-cos(l)*cos(p))
    }
    static func similar(_ a: String, _ b: String) -> Bool {
        func words(_ s: String) -> Set<String> {
            let ignored: Set<String> = ["a","an","the","possible","potential","hazard","risk","of","near","with","in","on"]
            return Set(s.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty && !ignored.contains($0) })
        }
        let x=words(a), y=words(b)
        guard !x.isEmpty, !y.isEmpty else { return false }
        return Double(x.intersection(y).count) / Double(min(x.count,y.count)) >= 0.6
    }
    static func dedupe(_ items: [VisionHazard]) -> [VisionHazard] {
        var result=[VisionHazard]()
        for item in items {
            let duplicate = result.contains { prior in
                guard let a=prior.direction, let b=item.direction, similar(prior.label,item.label) else { return false }
                return a.x*b.x+a.y*b.y+a.z*b.z > cos(12 * .pi/180)
            }
            if !duplicate { result.append(item) }
        }
        // Keep strongest findings when the six views together produce more than eight.
        let rank=["high":0,"medium":1,"low":2]
        return result.enumerated().sorted { a,b in
            let x=rank[a.element.severity, default: 2], y=rank[b.element.severity, default: 2]
            return x == y ? a.offset < b.offset : x < y
        }.prefix(8).map(\.element)
    }
}

enum VisionImage {
    static let size = 448

    static func decode(_ data: Data, panorama: Bool) throws -> CGImage {
        guard data.count <= 24_000_000, let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: panorama ? 4096 : size,
                kCGImageSourceShouldCacheImmediately: true
              ] as CFDictionary) else { throw VisionFailure.message("The photo could not be decoded or is too large (24 MB maximum).") }
        if panorama && !(Double(image.width)/Double(image.height) > 1.8 && Double(image.width)/Double(image.height) < 2.2) {
            throw VisionFailure.message("A panorama must be a full 360-degree equirectangular image (approximately 2:1).")
        }
        return image
    }

    static func rgba(_ image: CGImage) throws -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: image.width*image.height*4)
        let ok = bytes.withUnsafeMutableBytes { ptr -> Bool in
            guard let ctx = CGContext(data: ptr.baseAddress, width: image.width, height: image.height,
                bitsPerComponent: 8, bytesPerRow: image.width*4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
            ctx.draw(image, in: CGRect(x: 0,y: 0,width: image.width,height: image.height))
            return true
        }
        guard ok else { throw VisionFailure.message("Could not prepare the photo pixels.") }
        return bytes
    }

    static func perspective(_ source: CGImage, pixels: [UInt8], yaw: Double, size: Int = size) throws -> CGImage {
        var out = [UInt8](repeating: 255,count: size*size*4)
        let w=source.width, h=source.height
        for v in 0..<size {
            for u in 0..<size {
                let d=VisionProjection.direction(x: (Double(u)+0.5)/Double(size),y: (Double(v)+0.5)/Double(size),yaw: yaw)
                let uv=VisionProjection.equirectPoint(d)
                // Inverse of the supplied pixel-centre convention, with horizontal wrap.
                let sx=uv.x*Double(w)-0.5, sy=max(0,min(Double(h-1),uv.y*Double(h)-0.5))
                let x0=(Int(floor(sx)) % w + w) % w, x1=(x0+1)%w, y0=Int(floor(sy)), y1=min(h-1,y0+1)
                let fx=sx-floor(sx), fy=sy-floor(sy)
                for c in 0..<3 {
                    let a=Double(pixels[(y0*w+x0)*4+c])*(1-fx)+Double(pixels[(y0*w+x1)*4+c])*fx
                    let b=Double(pixels[(y1*w+x0)*4+c])*(1-fx)+Double(pixels[(y1*w+x1)*4+c])*fx
                    out[(v*size+u)*4+c]=UInt8(max(0,min(255,(a*(1-fy)+b*fy).rounded())))
                }
            }
        }
        guard let provider=CGDataProvider(data: Data(out) as CFData),
              let image=CGImage(width: size,height: size,bitsPerComponent: 8,bitsPerPixel: 32,bytesPerRow: size*4,
                space: CGColorSpaceCreateDeviceRGB(),bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                provider: provider,decode: nil,shouldInterpolate: true,intent: .defaultIntent) else {
            throw VisionFailure.message("Could not project the panorama.")
        }
        return image
    }

    static func thumbnail(_ image: CGImage, box: VisionBox?) -> String? {
        let b=box ?? VisionBox(x: 0.25,y: 0.25,w: 0.5,h: 0.5)
        let pad=0.08
        let x=max(0,b.x-pad), y=max(0,b.y-pad)
        let rect=CGRect(x: x*Double(image.width),y: y*Double(image.height),
                        width: (min(1,b.x+b.w+pad)-x)*Double(image.width),height: (min(1,b.y+b.h+pad)-y)*Double(image.height)).integral
        guard let crop=image.cropping(to: rect) else { return nil }
        let scale=min(1,224/Double(max(crop.width,crop.height)))
        let w=max(1,Int(Double(crop.width)*scale)),h=max(1,Int(Double(crop.height)*scale))
        guard let ctx=CGContext(data: nil,width: w,height: h,bitsPerComponent: 8,bytesPerRow: w*4,
            space: CGColorSpaceCreateDeviceRGB(),bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.draw(crop,in: CGRect(x:0,y:0,width:w,height:h))
        guard let small=ctx.makeImage() else { return nil }
        for quality in [0.65,0.4,0.2] {
            let data=NSMutableData()
            guard let dest=CGImageDestinationCreateWithData(data,"public.jpeg" as CFString,1,nil) else { return nil }
            CGImageDestinationAddImage(dest,small,[kCGImageDestinationLossyCompressionQuality:quality] as CFDictionary)
            if CGImageDestinationFinalize(dest), data.length <= 29_970 {
                // Base64 including its data URL prefix remains below 40 KB.
                return "data:image/jpeg;base64,"+(data as Data).base64EncodedString()
            }
        }
        return nil
    }
}

// Same local-only loading and generation function is exercised by the Mac harness.
enum VisionInference {
    static func input(image: CGImage, prompt: String = FixListVisionContract.prompt) -> UserInput {
        // In pinned MLXLMCommon 2.29.3, init(prompt:images:) does not populate
        // UserInput.images (property observers do not run during initialization).
        // The chat initializer explicitly collects media. Do not use the shortcut.
        UserInput(chat:[.user(prompt,images:[.ciImage(CIImage(cgImage:image))])],
                  additionalContext:["enable_thinking":false])
    }
    static func load(directory: URL) async throws -> ModelContainer {
        #if canImport(UIKit)
        let started = ProcessInfo.processInfo.systemUptime
        VisionDiagnostics.event("model.load.start", "ready=\(VisionModel.ready(at: directory))")
        defer { VisionDiagnostics.event("model.load.end", "seconds=\(ProcessInfo.processInfo.systemUptime-started)") }
        #endif
        GPU.set(cacheLimit: 64 * 1024 * 1024)
        return try await VLMModelFactory.shared.loadContainer(configuration: ModelConfiguration(directory: directory))
    }
    struct Review {
        let scene: VisionScene
        let raw: String
        let hazards: [VisionHazard]
        var json: String {
            get throws {
                let data = try JSONSerialization.data(withJSONObject: ["hazards": hazards.map(\.dictionary)])
                return String(decoding: data, as: UTF8.self)
            }
        }
    }
    struct Observation {
        let scene: VisionScene
        let raw: String
    }
    static func observe(container: ModelContainer, image: CGImage) async throws -> Observation {
        let classification = try await generate(container: container, image: image, prompt: FixListVisionContract.scenePrompt, maxTokens: 24)
        #if canImport(UIKit)
        VisionDiagnostics.modelOutput("scene", classification)
        #endif
        guard let scene = VisionScene(rawValue: classification.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()) else {
            throw VisionFailure.message("The vision model could not identify the visible scene. Please try another photo.")
        }
        let prompt = scene == .bathroom ? FixListVisionContract.bathroomPrompt : FixListVisionContract.prompt
        let raw = try await generate(container: container, image: image, prompt: prompt, maxTokens: 1200)
        #if canImport(UIKit)
        VisionDiagnostics.modelOutput("hazards", raw)
        #endif
        return Observation(scene: scene, raw: raw)
    }
    static func review(container: ModelContainer, image: CGImage) async throws -> Review {
        let observation = try await observe(container: container, image: image)
        return Review(scene: observation.scene, raw: observation.raw,
                      hazards: try FixListVisionContract.parse(observation.raw, scene: observation.scene))
    }
    static func describe(container: ModelContainer, image: CGImage) async throws -> String {
        try await review(container: container, image: image).json
    }
    static func generate(container: ModelContainer, image: CGImage, prompt: String, maxTokens: Int) async throws -> String {
        #if canImport(UIKit)
        let started = ProcessInfo.processInfo.systemUptime
        VisionDiagnostics.event("generate.start", "max_tokens=\(maxTokens) width=\(image.width) height=\(image.height)")
        defer { VisionDiagnostics.event("generate.end", "max_tokens=\(maxTokens) seconds=\(ProcessInfo.processInfo.systemUptime-started)") }
        #endif
        try Task.checkCancellation()
        return try await container.perform { context in
            let user=VisionInference.input(image:image,prompt:prompt)
            let input=try await context.processor.prepare(input: user)
            #if canImport(UIKit)
            VisionDiagnostics.event("generate.prepared", "max_tokens=\(maxTokens) has_image=\(input.image != nil)")
            #endif
            guard input.image != nil else { throw VisionFailure.message("The vision processor did not receive the photo. Analysis stopped.") }
            let start=Date()
            var bounded: [[String: Any]]?
            let result=try MLXLMCommon.generate(input: input,parameters: GenerateParameters(maxTokens: maxTokens,temperature: 0),context: context) { (tokens: [Int]) in
                if maxTokens > 24 && tokens.count % 16 == 0,
                   let items = FixListVisionContract.completePrefix(context.tokenizer.decode(tokens: tokens)),
                   FixListVisionContract.shouldBound(items) {
                    bounded = items
                    return .stop
                }
                if Task.isCancelled || Date().timeIntervalSince(start) > 45 {
                    #if canImport(UIKit)
                    VisionDiagnostics.event("generate.stopped", "cancelled=\(Task.isCancelled) seconds=\(Date().timeIntervalSince(start)) tokens=\(tokens.count)")
                    #endif
                    return .stop
                }
                return .more
            }
            try Task.checkCancellation()
            if let bounded { return try FixListVisionContract.canonicalResponse(bounded) }
            return result.output
        }
    }
}

// Pinned model metadata is mirrored in scan/vision/model-manifest.json for preloading.
enum VisionModel {
    static let id = "mlx-community/Qwen3-VL-2B-Instruct-4bit"
    static let revision = "9c4f5209e57b31f4b9dfba735de3fb983739c9cc"
    static let license = "Apache-2.0"
    static let folder = "qwen3-vl-2b-4bit"
    static let files: [File] = [
        File(name: "added_tokens.json",bytes: 707,sha256: "c0284b582e14987fbd3d5a2cb2bd139084371ed9acbae488829a1c900833c680"),
        File(name: "chat_template.jinja",bytes: 5292,sha256: "3636d0f0bd6bef02654cdffdc447b79cb2cef8ab02cc75267345946291a489e4"),
        File(name: "chat_template.json",bytes: 5502,sha256: "6f8a6a55027e3da5160105556cda5dd69f6423f1c32645f6730d32de7773d0c4"),
        File(name: "config.json",bytes: 7137,sha256: "6e992843f82cbaf02e8eae2f1c803f8a56f70951fa8a1f30fc1bf8d9ec2d7ec3"),
        File(name: "generation_config.json",bytes: 269,sha256: "1e241830b48b397cb0900101421df5450baddc7adf01e5fc86b5615865f3bae4"),
        File(name: "merges.txt",bytes: 1671853,sha256: "8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5"),
        File(name: "model.safetensors",bytes: 1782040921,sha256: "4750d95a2162829e127a94e83ac350d498d02070aab216c4687da48804a06ffb"),
        File(name: "model.safetensors.index.json",bytes: 82780,sha256: "30ba24b1c93436450f2e202de402058ecea7417cf66785d4c73e52d1575e6d97"),
        File(name: "preprocessor_config.json",bytes: 782,sha256: "93585062a80db5e8ca038efc7726a3e6411d9db948472d81d63c6303993be8c5"),
        File(name: "special_tokens_map.json",bytes: 613,sha256: "76862e765266b85aa9459767e33cbaf13970f327a0e88d1c65846c2ddd3a1ecd"),
        File(name: "tokenizer.json",bytes: 11422654,sha256: "aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4"),
        File(name: "tokenizer_config.json",bytes: 5445,sha256: "81ec7bb9530159b326c0bef1d0b6c33d392090524014ea3f0123a3c1eb9c2af5"),
        File(name: "video_preprocessor_config.json",bytes: 817,sha256: "59c5c9eb52182eb14c06ffb10ca9effd29adce5f238a95de23ca14a38dbd2cb1"),
        File(name: "vocab.json",bytes: 2776833,sha256: "ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910"),
    ]
    static var bytes: Int64 { files.reduce(0) { $0+$1.bytes } }
    static var directory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory,in: .userDomainMask)[0]
            .appendingPathComponent("FixListVision",isDirectory: true).appendingPathComponent(folder,isDirectory: true)
    }
    static func ready(at directory: URL = directory) -> Bool {
        files.allSatisfy { f in
            let url=directory.appendingPathComponent(f.name)
            guard let a=try? FileManager.default.attributesOfItem(atPath: url.path),
                  let size=a[.size] as? NSNumber else { return false }
            return size.int64Value == f.bytes
        }
    }
    struct File: Sendable { let name: String; let bytes: Int64; let sha256: String? }

    static func verify(_ url: URL, file: File) throws {
        let a=try FileManager.default.attributesOfItem(atPath: url.path)
        guard (a[.size] as? NSNumber)?.int64Value == file.bytes else { throw VisionFailure.message("Incomplete model download: \(file.name). Try Prepare again.") }
        if let expected=file.sha256 {
            let handle=try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            var hash=SHA256()
            while let chunk=try handle.read(upToCount: 1024*1024), !chunk.isEmpty { hash.update(data: chunk) }
            guard hash.finalize().map({ String(format:"%02x",$0) }).joined() == expected else {
                throw VisionFailure.message("Model checksum failed: \(file.name). Try Prepare again.")
            }
        }
    }
}

#if canImport(UIKit)
private enum VisionDiagnostics {
    static var selfTestEnabled: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.environment["FIXLIST_VISION_SELF_TEST"] == "1"
        #else
        return false
        #endif
    }

    static func event(_ name: String, _ detail: String = "") {
        NSLog("[FixListVision] %@ %@ available_bytes=%llu", name, detail, os_proc_available_memory())
    }

    // Model observations can describe a private room. Only the explicit Debug
    // diagnostic launch opts into logging them. Never log JPEG/base64 content.
    static func modelOutput(_ stage: String, _ text: String) {
        guard selfTestEnabled else { return }
        textEvent("model.output.\(stage)", text)
    }

    static func textEvent(_ name: String, _ text: String) {
        // Keep individual console entries short so a long model response is
        // recoverable even when the device log transport truncates entries.
        let characters = Array(text)
        let count = max(1, (characters.count + 699) / 700)
        for part in 0..<count {
            let chunk = String(characters.dropFirst(part*700).prefix(700))
            event(name, "part=\(part+1)/\(count) \(chunk)")
        }
    }

    static func resolved(_ method: String, response: [String: Any], seconds: Double) {
        guard selfTestEnabled else { return }
        var summary = response
        if let hazards = response["hazards"] as? [[String: Any]] {
            summary["hazards"] = hazards.map { item in
                var finding = item
                finding.removeValue(forKey: "thumbnail")
                return finding
            }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: summary, options: [.sortedKeys]) else { return }
        event("resolve", "method=\(method) seconds=\(seconds)")
        textEvent("resolve.result_without_thumbnails", String(decoding: data, as: UTF8.self))
    }
}

private final class VisionDownloadProgress: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    let update: @Sendable (Double) -> Void
    init(_ update: @escaping @Sendable (Double)->Void) { self.update=update }
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,totalBytesWritten: Int64,totalBytesExpectedToWrite: Int64) {
        if totalBytesExpectedToWrite > 0 { update(min(1,Double(totalBytesWritten)/Double(totalBytesExpectedToWrite))) }
    }
    func urlSession(_ session: URLSession,downloadTask: URLSessionDownloadTask,didFinishDownloadingTo location: URL) {}
}

private actor VisionService {
    private var container: ModelContainer?
    private var busy=false
    private var downloading=false
    private var fraction=0.0

    func availability() -> [String: Any] {
        let supported=ProcessInfo.processInfo.physicalMemory >= 6_000_000_000
        var result: [String: Any] = ["available":supported,"state": supported ? (downloading ? "downloading" : (VisionModel.ready() ? "ready" : "needs-download")) : "unsupported",
            "model":["id":VisionModel.id,"license":VisionModel.license,"bytes":VisionModel.bytes]]
        if downloading { result["progress"]=fraction }
        if !supported { result["reason"]="Vision analysis requires an Apple silicon device with at least 6 GB of memory." }
        return result
    }
    func unload() { container=nil; GPU.clearCache() }

    func prepare(progress: @escaping @Sendable (Double,String)->Void) async throws {
        guard !busy else { throw VisionFailure.message("BUSY: Another vision operation is already running.") }
        busy=true
        defer { busy=false; downloading=false }
        guard ProcessInfo.processInfo.physicalMemory >= 6_000_000_000 else { throw VisionFailure.message("Vision analysis requires at least 6 GB of device memory.") }
        let dir=VisionModel.directory
        try FileManager.default.createDirectory(at: dir,withIntermediateDirectories: true)
        var values=URLResourceValues(); values.isExcludedFromBackup=true
        var mutableDir=dir; try mutableDir.setResourceValues(values)
        if !VisionModel.ready() {
            downloading=true
            var completed: Int64=0
            for f in VisionModel.files {
                try Task.checkCancellation()
                let destination=dir.appendingPathComponent(f.name)
                if (try? VisionModel.verify(destination,file:f)) != nil {
                    completed += f.bytes
                    continue
                }
                let base=completed, total=VisionModel.bytes
                let delegate=VisionDownloadProgress { value in
                    let combined=Double(base)/Double(total)+value*Double(f.bytes)/Double(total)
                    progress(combined,"download")
                    Task { await self.setProgress(combined) }
                }
                let url=URL(string:"https://huggingface.co/\(VisionModel.id)/resolve/\(VisionModel.revision)/\(f.name)")!
                var request=URLRequest(url:url); request.timeoutInterval=1800
                let (temporary,response)=try await URLSession.shared.download(for:request,delegate:delegate)
                defer { try? FileManager.default.removeItem(at:temporary) }
                guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw VisionFailure.message("Model download failed for \(f.name). Check internet access and try Prepare again.") }
                try VisionModel.verify(temporary,file:f)
                // Completed files survive interruptions; partial individual files are retried.
                _ = try? FileManager.default.removeItem(at:destination)
                try FileManager.default.moveItem(at:temporary,to:destination)
                completed += f.bytes
                fraction=Double(completed)/Double(total); progress(fraction,"download")
            }
        }
        downloading=false
        progress(0,"load")
        do {
            if container == nil { container=try await VisionInference.load(directory:dir) }
            try Task.checkCancellation()
            progress(1,"load")
        } catch { unload(); throw error }
    }
    private func setProgress(_ value: Double) { fraction=value }

    func analyze(data: Data, panorama: Bool) async throws -> [VisionHazard] {
        let started = ProcessInfo.processInfo.systemUptime
        VisionDiagnostics.event("analyze.start", "panorama=\(panorama) jpeg_bytes=\(data.count) model_ready=\(VisionModel.ready()) cached=\(container != nil)")
        defer { VisionDiagnostics.event("analyze.end", "panorama=\(panorama) seconds=\(ProcessInfo.processInfo.systemUptime-started)") }
        guard !busy else { throw VisionFailure.message("BUSY: Another vision operation is already running.") }
        busy=true
        // A 360° review runs for about a minute without touches. If auto-lock backgrounds the app, iOS refuses
        // GPU work and MLX aborts the process, so keep the screen awake for the duration of the review.
        await MainActor.run { UIApplication.shared.isIdleTimerDisabled = true }
        defer { unload(); busy=false; Task { @MainActor in UIApplication.shared.isIdleTimerDisabled = false } }
        guard ProcessInfo.processInfo.physicalMemory >= 6_000_000_000 else { throw VisionFailure.message("Vision analysis requires at least 6 GB of device memory.") }
        guard VisionModel.ready() else { throw VisionFailure.message("Download the vision model with Prepare before analyzing a room.") }
        let image=try VisionImage.decode(data,panorama:panorama)
        VisionDiagnostics.event("analyze.decoded", "width=\(image.width) height=\(image.height)")
        if container == nil { container=try await VisionInference.load(directory:VisionModel.directory) }
        guard let model=container else { throw VisionFailure.message("The vision model could not load.") }
        var result=[VisionHazard]()
        let pixels=panorama ? try VisionImage.rgba(image) : []
        for yaw in panorama ? [0.0,60,120,180,240,300] : [0.0] {
            try Task.checkCancellation()
            let viewStarted = ProcessInfo.processInfo.systemUptime
            VisionDiagnostics.event("view.start", "yaw=\(yaw)")
            let view=panorama ? try VisionImage.perspective(image,pixels:pixels,yaw:yaw) : image
            var hazards=try await VisionInference.review(container:model,image:view).hazards
            for index in hazards.indices {
                if panorama {
                    // An ungrounded finding has no known world direction. Never invent one.
                    if let box=hazards[index].box {
                        hazards[index].direction=VisionProjection.direction(x:box.x+box.w/2,y:box.y+box.h/2,yaw:yaw)
                    }
                }
                hazards[index].thumbnail=VisionImage.thumbnail(view,box:hazards[index].box)
            }
            result += hazards
            GPU.clearCache()
            VisionDiagnostics.event("view.end", "yaw=\(yaw) seconds=\(ProcessInfo.processInfo.systemUptime-viewStarted) hazards=\(hazards.count)")
        }
        return panorama ? VisionProjection.dedupe(result) : result
    }
}

@objc(FixListVisionPlugin)
public class FixListVisionPlugin: CAPPlugin, CAPBridgedPlugin, @unchecked Sendable {
    public let identifier="FixListVisionPlugin"
    public let jsName="FixListVision"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name:"availability",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"prepare",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"describePhoto",returnType:CAPPluginReturnPromise),
        CAPPluginMethod(name:"describePanorama",returnType:CAPPluginReturnPromise)
    ]
    private let service=VisionService()
    private let operationLock=NSLock()
    private var operation: Task<Void,Never>?
    private var running=false
    private var memoryObserver: NSObjectProtocol?

    public override func load() {
        VisionDiagnostics.event("plugin.load", "physical_bytes=\(ProcessInfo.processInfo.physicalMemory) model_ready=\(VisionModel.ready())")
        if !VisionModel.ready() {
            let incomplete = VisionModel.files.compactMap { file -> String? in
                let attributes = try? FileManager.default.attributesOfItem(atPath: VisionModel.directory.appendingPathComponent(file.name).path)
                let bytes = (attributes?[.size] as? NSNumber)?.int64Value
                return bytes == file.bytes ? nil : "\(file.name):actual=\(bytes ?? -1),expected=\(file.bytes)"
            }
            VisionDiagnostics.event("model.files.incomplete", "directory=\(VisionModel.directory.path) files=\(incomplete.joined(separator: ";"))")
        }
        memoryObserver=NotificationCenter.default.addObserver(forName:UIApplication.didReceiveMemoryWarningNotification,object:nil,queue:nil) { [weak self] _ in
            guard let self else { return }
            VisionDiagnostics.event("memory.warning")
            self.operationLock.lock(); self.operation?.cancel(); self.operationLock.unlock()
            Task { await self.service.unload() }
        }
        #if DEBUG
        if VisionDiagnostics.selfTestEnabled { startSelfTest() }
        #endif
    }
    deinit { if let memoryObserver { NotificationCenter.default.removeObserver(memoryObserver) }; operation?.cancel() }

    @objc func availability(_ call: CAPPluginCall) {
        Task { call.resolve(await service.availability()) }
    }
    @objc func prepare(_ call: CAPPluginCall) {
        run(call) {
            try await self.service.prepare { fraction,phase in
                DispatchQueue.main.async { self.notifyListeners("visionProgress",data:["fraction":max(0,min(1,fraction)),"phase":phase]) }
            }
            return ["available":true]
        }
    }
    @objc func describePhoto(_ call: CAPPluginCall) { describe(call,panorama:false) }
    @objc func describePanorama(_ call: CAPPluginCall) { describe(call,panorama:true) }
    private func describe(_ call: CAPPluginCall,panorama:Bool) {
        guard let id=call.getString(panorama ? "stopId":"photoId"), !id.isEmpty, id.count <= 200,
              let base64=call.getString("jpegBase64"), base64.utf8.count <= 32_000_000 else {
            reject(call, "Provide a photo/stop ID and JPEG base64 (maximum 24 MB).", "INVALID_INPUT"); return
        }
        run(call) {
            let encoded=base64.hasPrefix("data:image/jpeg;base64,") ? String(base64.dropFirst(23)) : base64
            guard let data=Data(base64Encoded:encoded), data.starts(with:[0xff,0xd8]) else {
                throw VisionFailure.message("The photo must be a valid base64-encoded JPEG.")
            }
            let items=try await self.service.analyze(data:data,panorama:panorama)
            return ["model":VisionModel.id,"hazards":items.map(\.dictionary)]
        }
    }
    private func run(_ call: CAPPluginCall,work: @escaping @Sendable () async throws -> [String:Any]) {
        operationLock.lock()
        guard !running else { operationLock.unlock(); reject(call, "Another vision operation is already running.", "BUSY"); return }
        running=true
        operation=Task.detached(priority:.userInitiated) {
            defer { self.finishOperation() }
            let started = ProcessInfo.processInfo.systemUptime
            do {
                let response = try await work()
                VisionDiagnostics.resolved(call.methodName ?? "unknown", response: response, seconds: ProcessInfo.processInfo.systemUptime-started)
                call.resolve(response)
            }
            catch is CancellationError { self.reject(call, "Vision analysis stopped to release memory. Close other apps and try again.", "CANCELLED") }
            catch { self.reject(call, error.localizedDescription, "VISION_ERROR", error: error) }
        }
        operationLock.unlock()
    }
    private func finishOperation() {
        operationLock.lock(); running=false; operation=nil; operationLock.unlock()
    }

    private func reject(_ call: CAPPluginCall, _ message: String, _ code: String, error: Error? = nil) {
        let native = error.map { " domain=\(($0 as NSError).domain) native_code=\(($0 as NSError).code)" } ?? ""
        VisionDiagnostics.event("reject", "method=\(call.methodName ?? "unknown") code=\(code) message=\(message)\(native)")
        call.reject(message, code)
    }

    #if DEBUG
    private func startSelfTest() {
        Task { @MainActor [weak self] in
            guard let self else { return }
            VisionDiagnostics.event("selftest.waiting")
            let deadline = ProcessInfo.processInfo.systemUptime + 30
            while UIApplication.shared.applicationState != .active || self.bridge?.webView?.isLoading != false {
                guard ProcessInfo.processInfo.systemUptime < deadline else {
                    VisionDiagnostics.event("selftest.failed", "App/WebView did not become ready within 30 seconds; unlock the phone and launch again.")
                    return
                }
                try? await Task.sleep(nanoseconds: 200_000_000)
            }
            guard let webView = self.bridge?.webView else { return }
            do {
                let room = ProcessInfo.processInfo.environment["FIXLIST_VISION_SELF_TEST_ROOM"] ?? "bathroom"
                let result = try await webView.callAsyncJavaScript(Self.selfTestScript, arguments: ["roomId": room], in: nil, contentWorld: .page)
                let json = try JSONSerialization.data(withJSONObject: result ?? [:], options: [.sortedKeys])
                // The script omits base64 thumbnails, retaining every model finding.
                VisionDiagnostics.textEvent("selftest.result_without_thumbnails", String(decoding: json, as: UTF8.self))
            } catch {
                VisionDiagnostics.event("selftest.failed", error.localizedDescription)
            }
        }
    }

    // Debug-only, explicit launch opt-in. Read saved bytes without modifying
    // captures or their earlier reviews. Calls the exact public bridge methods.
    private static let selfTestScript = #"""
const names = await indexedDB.databases();
if (!names.some(d => d.name === 'fixlist-captures')) throw new Error('No saved captures database; save a room before running the self-test.');
const db = await new Promise((resolve, reject) => {
  const request = indexedDB.open('fixlist-captures', 1);
  request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error('Saved captures database is unavailable.')); };
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('Saved captures database is blocked.'));
  request.onsuccess = () => resolve(request.result);
});
let record;
try {
  record = await new Promise((resolve, reject) => {
    const tx = db.transaction('rooms', 'readonly');
    const request = tx.objectStore('rooms').openCursor();
    let selected = null;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value?.manifest?.roomId === roomId && cursor.value.panoramaBlobs?.size) {
        if (!selected || cursor.value.manifest.createdAt > selected.manifest.createdAt) selected = cursor.value;
      }
      cursor.continue();
    };
    tx.oncomplete = () => resolve(selected);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Could not read saved capture.'));
  });
} finally { db.close(); }
if (!record) throw new Error('No saved panorama for the requested room. No capture was changed.');
const stop = record.manifest.tour?.stops?.[0];
const panorama = stop && record.panoramaBlobs.get(stop.panorama.fileId);
if (!(panorama instanceof Blob)) throw new Error('The saved panorama JPEG is missing.');
const base64 = blob => new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onerror = () => reject(reader.error);
  reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob);
});
let photo = record.photos?.values().next().value;
let photoSource = 'saved-photo';
if (!(photo instanceof Blob)) {
  // A real image crop is test input, never a substitute model result. Preserve
  // the original 2:1 panorama for the second call, including coverage gaps.
  const url = URL.createObjectURL(panorama);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 448;
    const edge = Math.min(image.width, image.height);
    canvas.getContext('2d').drawImage(image, (image.width-edge)/2, (image.height-edge)/2, edge, edge, 0, 0, 448, 448);
    photo = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!photo) throw new Error('Could not make a test JPEG from the saved panorama.');
    photoSource = 'saved-panorama-center-crop';
  } finally { URL.revokeObjectURL(url); }
}
// Use the same underlying nativePromise bridge as registerPlugin(), so this
// works from the home screen before the lazy room UI imports its JS proxy.
const capacitor = window.Capacitor;
if (typeof capacitor?.nativePromise !== 'function') throw new Error('FixListVision bridge is unavailable.');
const results = [];
for (const test of [
  {method: 'describePhoto', kind: 'photo', source: photoSource, id: 'photoId', blob: photo},
  {method: 'describePanorama', kind: 'panorama', source: 'saved-panorama', id: 'stopId', blob: panorama}
]) {
  const start = performance.now();
  try {
    const response = await capacitor.nativePromise('FixListVision', test.method, {[test.id]: 'vision-self-test', jpegBase64: await base64(test.blob)});
    results.push({kind: test.kind, source: test.source, seconds: (performance.now()-start)/1000,
      result: {...response, hazards: response.hazards.map(({thumbnail, ...finding}) => finding)}});
  } catch (error) {
    results.push({kind: test.kind, source: test.source, seconds: (performance.now()-start)/1000,
      error: {message: String(error?.message || error), code: error?.code || null}});
  }
}
return {capture: {id: record.manifest.captureId, roomId: record.manifest.roomId,
  createdAt: record.manifest.createdAt, panorama: stop.panorama},
  tests: results, completed: results.every(r => !r.error)};
"""#
    #endif
}
#endif
