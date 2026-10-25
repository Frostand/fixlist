import CryptoKit
import Foundation

public enum ProbeFailure: Error, LocalizedError {
    case invalid(String)
    public var errorDescription: String? { if case .invalid(let message) = self { return message }; return nil }
}

public enum AssetVerifier {
    public static let manifestSHA256 = "4e35990a4bf7650502263668150f85d1a5c1a8fa3e648c88e2391b14561ce478"
    public static let expectedBytes = 340_058_078
    public static let revision = "e61d9ee79a01ad4ebf6b3d8bcfe2a03f6b8da105"
    private struct Manifest: Decodable {
        struct File: Decodable { let path: String; let bytes: Int; let sha256: String }
        let revision: String
        let assetBytes: Int
        let files: [File]
    }
    public static func verify(root: URL) throws -> Int {
        guard !Thread.isMainThread else { throw ProbeFailure.invalid("Asset hash must run off the main thread") }
        let root = root.standardizedFileURL.resolvingSymlinksInPath()
        let data = try Data(contentsOf: root.appendingPathComponent("asset-manifest.json"))
        guard hex(SHA256.hash(data: data)) == manifestSHA256 else { throw ProbeFailure.invalid("Manifest is not the frozen probe manifest") }
        let manifest = try JSONDecoder().decode(Manifest.self, from: data)
        guard manifest.revision == revision, manifest.assetBytes == expectedBytes,
              manifest.files.count == 19, Set(manifest.files.map(\.path)).count == 19 else {
            throw ProbeFailure.invalid("Manifest identity or file count mismatch")
        }
        var total = 0
        for file in manifest.files {
            try Task.checkCancellation()
            guard !file.path.hasPrefix("/"), !file.path.split(separator: "/").contains("..") else { throw ProbeFailure.invalid("Invalid manifest path") }
            let url = root.appendingPathComponent(file.path).resolvingSymlinksInPath()
            guard url.path.hasPrefix(root.path + "/") else { throw ProbeFailure.invalid("Asset escapes local root") }
            let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
            guard values.isRegularFile == true, values.fileSize == file.bytes else { throw ProbeFailure.invalid("Missing or size-mismatched asset: \(file.path)") }
            guard let stream = InputStream(url: url) else { throw ProbeFailure.invalid("Cannot open asset") }
            stream.open()
            defer { stream.close() }
            var hash = SHA256(); var count = 0
            var buffer = [UInt8](repeating: 0, count: 1_048_576)
            while true {
                try Task.checkCancellation()
                let n = stream.read(&buffer, maxLength: buffer.count)
                guard n >= 0 else { throw stream.streamError ?? ProbeFailure.invalid("Asset read error") }
                if n == 0 { break }
                hash.update(data: Data(buffer.prefix(n))); count += n
            }
            guard count == file.bytes, hex(hash.finalize()) == file.sha256 else { throw ProbeFailure.invalid("SHA-256 mismatch: \(file.path)") }
            total += count
        }
        guard total == expectedBytes else { throw ProbeFailure.invalid("Total asset byte mismatch") }
        return total
    }
    private static func hex<D: Sequence>(_ digest: D) -> String where D.Element == UInt8 {
        digest.map { String(format: "%02x", $0) }.joined()
    }
}
