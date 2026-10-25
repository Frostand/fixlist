import Foundation
import Darwin

/// JSON Lines; synchronized because SDK stages and UI playback use different executors.
public final class ProbeLog: @unchecked Sendable {
    private let lock = NSLock()
    private let url: URL
    private let origin = ProcessInfo.processInfo.systemUptime
    public init(url: URL) throws {
        self.url = url
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if !FileManager.default.fileExists(atPath: url.path) { try Data().write(to: url) }
    }
    public func event(_ name: String, fields: [String: String] = [:]) {
        lock.lock(); defer { lock.unlock() }
        var object = fields
        object["event"] = name
        object["uptime_s"] = String(ProcessInfo.processInfo.systemUptime)
        object["run_elapsed_s"] = String(ProcessInfo.processInfo.systemUptime - origin)
        object["main_thread"] = String(Thread.isMainThread)
        var usage = rusage()
        if getrusage(RUSAGE_SELF, &usage) == 0 { object["process_peak_rss_bytes"] = String(usage.ru_maxrss) }
        do {
            var data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            data.append(10)
            let handle = try FileHandle(forWritingTo: url)
            defer { try? handle.close() }
            try handle.seekToEnd(); try handle.write(contentsOf: data)
            print(String(decoding: data, as: UTF8.self), terminator: "")
        } catch { fputs("probe log write failed: \(error)\n", stderr) }
    }
}
