import Foundation
import ProbeCore

struct Prompt: Decodable { let id: String; let text: String }
@main struct Batch {
    static func main() async throws {
        let args = CommandLine.arguments
        guard args.count == 4 else { throw ProbeFailure.invalid("Usage: voice-pack-batch ASSET_ROOT INVENTORY_JSON OUTPUT_DIRECTORY") }
        let root = URL(fileURLWithPath: args[1]), inventory = URL(fileURLWithPath: args[2]), output = URL(fileURLWithPath: args[3])
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        try await Task.detached {
            let prompts = try JSONDecoder().decode([Prompt].self, from: Data(contentsOf: inventory))
            let log = try ProbeLog(url: output.appendingPathComponent("generation-metrics.jsonl"))
            let backend = ProbeBackend(root: root, log: log)
            for prompt in prompts {
                guard prompt.id.range(of: "^[a-z][a-z0-9-]+$", options: .regularExpression) != nil else { throw ProbeFailure.invalid("Invalid prompt ID") }
                let result = try await backend.synthesize(prompt.text)
                try result.wav.write(to: output.appendingPathComponent(prompt.id + ".wav"), options: .atomic)
                log.event("whole_utterance_saved", fields: ["id": prompt.id, "text": prompt.text, "synthesis_s": String(result.synthesisSeconds)])
            }
        }.value
    }
}
