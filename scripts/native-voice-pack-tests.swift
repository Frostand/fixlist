import Foundation
import CryptoKit

// Only platform/bridge boundaries are faked. All phrase selection, lifecycle,
// generation identity, startup, delegates and teardown are extracted from production.
private enum AssistantError: Error { case unavailable }
struct DispatchTime { static func now() -> DispatchTime { DispatchTime() } }
final class DispatchWorkItem { var canceled = false; func cancel() { canceled = true } }
final class FixtureQueue {
    var callbacks: [() -> Void] = []
    func async(execute: @escaping () -> Void) { callbacks.append(execute) }
    func drain() { while !callbacks.isEmpty { callbacks.removeFirst()() } }
}
enum DispatchQueue {
    enum QoS { case userInitiated }
    static let main = FixtureQueue(), io = FixtureQueue()
    static func global(qos: QoS) -> FixtureQueue { io }
}
enum Bundle { static var resource: URL?; static let main = BundleValue() }
struct BundleValue { var resourceURL: URL? { Bundle.resource } }
final class CAPPluginCall {
    let id: String; let language: String?; let text: String?
    var results: [[String: Any]] = [], rejections: [String] = []
    init(_ id: String, language: String? = "en", text: String? = nil) { self.id = id; self.language = language; self.text = text }
    func getString(_ key: String) -> String? { key == "sessionId" ? id : key == "language" ? language : key == "text" ? text : nil }
    func resolve(_ data: [String: Any]) { results.append(data) }
    func reject(_ message: String, _ code: String) { rejections.append(code) }
}
final class AVSpeechSynthesisVoice {
    struct Traits: OptionSet { let rawValue: Int; static let isNoveltyVoice = Traits(rawValue: 1); static let isPersonalVoice = Traits(rawValue: 2) }
    enum Quality: Int { case `default`, enhanced, premium }
    static var voices = [AVSpeechSynthesisVoice("en-US"), AVSpeechSynthesisVoice("es-US")]
    let language: String; var identifier: String { language }; let quality = Quality.default; let voiceTraits = Traits([])
    init(_ language: String) { self.language = language }
    static func speechVoices() -> [AVSpeechSynthesisVoice] { voices }
}
let AVSpeechUtteranceDefaultSpeechRate: Float = 0.5
final class AVSpeechUtterance {
    let speechString: String; var voice: AVSpeechSynthesisVoice?; var rate: Float = 0
    init(string: String = "") { speechString = string }
}
final class AVSpeechSynthesizer {
    enum Boundary { case immediate }
    var utterances: [AVSpeechUtterance] = []; var stops = 0
    func speak(_ utterance: AVSpeechUtterance) { utterances.append(utterance) }
    func stopSpeaking(at: Boundary) { stops += 1 }
}
protocol AVAudioPlayerDelegate: AnyObject {}
final class AVAudioPlayer {
    static var created: [AVAudioPlayer] = [], nextPlay = true, nextPrepare = true, throwOnInit = false
    weak var delegate: AVAudioPlayerDelegate?
    let data: Data; var plays = 0, stops = 0; var onStop: (() -> Void)?
    init(data: Data) throws { if Self.throwOnInit { throw AssistantError.unavailable }; self.data = data; Self.created.append(self) }
    func prepareToPlay() -> Bool { Self.nextPrepare }
    func play() -> Bool { plays += 1; return Self.nextPlay }
    func stop() { stops += 1; onStop?() }
}
final class FakeEngine { final class Input { var removes = 0; func removeTap(onBus: Int) { removes += 1 } }; let inputNode = Input(); func stop() {} }
final class FakeRequest { func endAudio() {} }
final class FakeTask { func cancel() {} }
enum UIApplication { static let didEnterBackgroundNotification = Notification.Name("background") }
let AVAudioSessionInterruptionTypeKey = "type"
enum AVAudioSession { static let interruptionNotification = Notification.Name("interruption"); enum InterruptionType: UInt { case began = 1, ended = 0 } }
/* PRODUCTION_HELPERS */
final class Harness: AVAudioPlayerDelegate {
    let synthesizer = AVSpeechSynthesizer()
    /* PRODUCTION_STATE */
    var audioEngine: FakeEngine?, recognitionRequest: FakeRequest?, recognitionTask: FakeTask?, recognizer: NSObject?
    var transcript = "", listenID: String?, pendingStart: CAPPluginCall?, pendingStops: [CAPPluginCall] = []
    var stopTimer: DispatchWorkItem?, tapInstalled = false
    var restores = 0, configureFails = false, events: [(String, [String: Any])] = []
    func configureAudio(recording: Bool) throws { if configureFails { throw AssistantError.unavailable } }
    func restoreAudio() { restores += 1 }
    func notifyListeners(_ name: String, data: [String: Any]) { events.append((name, data)) }
    /* PRODUCTION_METHODS */
}
var checks = 0
func expect(_ value: @autoclosure () -> Bool, _ message: String) {
    checks += 1; if !value() { print("FAIL: \(message)"); exit(1) }
}
func drain() { DispatchQueue.main.drain() }
func finishIO() { DispatchQueue.io.drain(); drain() }
func events(_ h: Harness, _ name: String) -> [[String: Any]] { h.events.filter { $0.0 == name }.map(\.1) }
func speak(_ h: Harness, _ id: String, text: String, language: String = "en") -> CAPPluginCall {
    let call = CAPPluginCall(id, language: language, text: text); h.speak(call); drain(); return call
}
let root = URL(fileURLWithPath: CommandLine.arguments[1]); Bundle.resource = root
let phrase = "What would you like help with at home?"
let assetRoot = root.appendingPathComponent("public/voice/en")
let inventory = try! JSONSerialization.jsonObject(with: Data(contentsOf: assetRoot.appendingPathComponent("manifest.json"))) as! [String: Any]
let clips = inventory["clips"] as! [[String: Any]]
expect(clips.count == 30, "Actual manifest contains all thirty whole clips")
for clip in clips {
    let text = clip["text"] as! String
    expect(AssistantPromptPack.contains(text: " \n" + text + "\n ", language: "en"), "Exact shared trim selects \(clip["id"]!)")
    let data = try! AssistantPromptPack.clipData(text: text, language: "en", root: assetRoot)
    expect(data == (try! Data(contentsOf: assetRoot.appendingPathComponent(clip["path"] as! String))), "Actual loader hash-validates \(clip["id"]!)")
}
for text in [phrase.lowercased(), phrase + "!", phrase.replacingOccurrences(of: "like help", with: "like  help"), "Which room is the chair in?", "Personal arbitrary request"] {
    expect(!AssistantPromptPack.contains(text: text, language: "en"), "No approximate lookup: \(text)")
    expect((try! AssistantPromptPack.clipData(text: text, language: "en", root: nil)) == nil, "Unknown text alone may use system voice without pack IO")
}
expect(!AssistantPromptPack.contains(text: phrase, language: "es"), "Selected non-English language never uses English clip")
do { _ = try AssistantPromptPack.clipData(text: phrase, language: "en", root: nil); expect(false, "Known missing pack rejected") } catch { expect(true, "Known missing pack throws rather than system fallback") }
let temp = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try! FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)
try! Data("{}".utf8).write(to: temp.appendingPathComponent("manifest.json"))
do { _ = try AssistantPromptPack.clipData(text: phrase, language: "en", root: temp); expect(false, "Corrupt manifest accepted") } catch { expect(true, "Frozen manifest pin rejects tamper") }
try! FileManager.default.removeItem(at: temp)

let h = Harness(), first = speak(h, "first", text: phrase)
expect(h.speechID == "first" && first.results.isEmpty && h.speechPlayer == nil && h.pendingSpeech === first, "Known clip owns session while background IO is pending")
expect(events(h, "speechProgress").isEmpty && h.synthesizer.utterances.isEmpty, "No invented start or fallback during load")
finishIO(); let player = h.speechPlayer!
expect(first.results.count == 1 && player.plays == 1 && events(h, "speechProgress").count == 1, "Startup ACK and one start only after play accepted")
expect(events(h, "speechProgress").allSatisfy { $0["stage"] as? String == "started" }, "Clips never invent word progress")
player.onStop = { expect(h.speechID == nil && h.speechPlayer == nil && h.speechTicket == nil, "Identity invalidated before AVAudioPlayer stop callback"); h.audioPlayerDidFinishPlaying(player, successfully: true) }
h.audioPlayerDidFinishPlaying(player, successfully: true); drain()
expect(events(h, "speechEnded").count == 1 && events(h, "speechEnded").last?["reason"] as? String == "completed", "Actual successful delegate emits exactly one completed terminal")
h.audioPlayerDidFinishPlaying(player, successfully: false); h.audioPlayerDecodeErrorDidOccur(player, error: nil); drain()
expect(events(h, "speechEnded").count == 1, "Duplicate and late delegates are ignored")

let loadCancel = Harness(), canceled = speak(loadCancel, "load-cancel", text: phrase)
loadCancel.stopSpeaking(CAPPluginCall("load-cancel")); drain(); let createdBefore = AVAudioPlayer.created.count
finishIO()
expect(canceled.rejections == ["CANCELLED"] && canceled.results.isEmpty && AVAudioPlayer.created.count == createdBefore, "Cancel during file/hash preparation cannot create or start late audio")
expect(events(loadCancel, "speechEnded").count == 1 && loadCancel.synthesizer.utterances.isEmpty, "Cancel never falls back or doubles terminal")

let replaced = Harness(), oldCall = speak(replaced, "same-id", text: phrase), ticket = replaced.speechTicket
let newer = speak(replaced, "same-id", text: "Would you like to review the draft?")
expect(replaced.speechTicket !== ticket && oldCall.rejections == ["CANCELLED"], "Replacement retires generation even when sessionId is reused")
finishIO(); let replacement = replaced.speechPlayer!
expect(newer.results.count == 1 && replacement.data == (try! AssistantPromptPack.clipData(text: "Would you like to review the draft?", language: "en", root: assetRoot)), "Only latest generation's prepared bytes can play")
replaced.audioPlayerDidFinishPlaying(player, successfully: true); drain()
expect(replaced.speechPlayer === replacement, "An older player's delegate cannot end newer speech")
replaced.stopSpeaking(CAPPluginCall("wrong-id")); drain(); expect(replacement.stops == 0, "Old JS stop cannot stop a newer speechID")
replaced.audioPlayerDidFinishPlaying(replacement, successfully: false); drain()
expect(events(replaced, "speechEnded").last?["reason"] as? String == "error" && replaced.synthesizer.utterances.isEmpty, "Unsuccessful completion is error with no surprise fallback")

let decode = Harness(); _ = speak(decode, "decode", text: phrase); finishIO(); let decoded = decode.speechPlayer!
decode.audioPlayerDecodeErrorDidOccur(decoded, error: NSError(domain: "audio", code: 1)); drain()
expect(events(decode, "speechEnded").last?["reason"] as? String == "error" && decode.synthesizer.utterances.isEmpty, "Decode failure after start ends once, never falls back")
for mode in ["prepare", "play", "init", "configure"] {
    AVAudioPlayer.nextPrepare = mode != "prepare"; AVAudioPlayer.nextPlay = mode != "play"; AVAudioPlayer.throwOnInit = mode == "init"
    let failing = Harness(); failing.configureFails = mode == "configure"
    let call = speak(failing, mode, text: phrase); finishIO()
    expect(call.rejections == ["VOICE_PACK_UNAVAILABLE"] && events(failing, "speechProgress").isEmpty && events(failing, "speechEnded").count == 1, "\(mode) failure emits no invented start and one terminal")
    expect(failing.synthesizer.utterances.isEmpty, "\(mode) known-clip error does not change voice")
}
AVAudioPlayer.nextPrepare = true; AVAudioPlayer.nextPlay = true; AVAudioPlayer.throwOnInit = false

let system = Harness(), arbitrary = speak(system, "system", text: "An arbitrary public test sentence.")
expect(arbitrary.results.count == 1 && system.spokenUtterance?.speechString == "An arbitrary public test sentence." && system.speechPlayer == nil, "Unknown English uses installed AVSpeech")
let utterance = system.spokenUtterance!
_ = speak(system, "clip-after-system", text: phrase); finishIO(); let activeClip = system.speechPlayer!
system.speechSynthesizer(system.synthesizer, didFinish: utterance); system.speechSynthesizer(system.synthesizer, didCancel: utterance); system.speechSynthesizer(system.synthesizer, didStart: utterance); drain()
expect(system.speechPlayer === activeClip && system.speechID == "clip-after-system", "Old system delegates cannot interfere with newer clip")
let nonEnglish = Harness(), spanish = speak(nonEnglish, "es", text: phrase, language: "es")
expect(spanish.results.count == 1 && nonEnglish.spokenUtterance?.voice?.language == "es-US" && nonEnglish.speechPlayer == nil, "Non-English uses installed selected-language system voice")

let shared = Harness(); _ = speak(shared, "during-recognition-teardown", text: phrase)
shared.listenID = "mic-old"; shared.audioEngine = FakeEngine(); let restoresBefore = shared.restores
shared.finishRecognition(id: "mic-old", reason: "cancelled")
expect(shared.restores == restoresBefore && shared.speechID != nil, "Recognition release does not restore audio while a clip is still preparing")
finishIO(); shared.listenID = "mic-old-2"; shared.audioEngine = FakeEngine()
shared.finishRecognition(id: "mic-old-2", reason: "cancelled")
expect(shared.restores == restoresBefore && shared.speechPlayer != nil, "Recognition release does not restore audio while a clip is playing")
// startListening is checked above to call this exact production helper before permission work.
let micPlayer = shared.speechPlayer!; shared.cancelCurrentSpeech(reason: "cancelled")
expect(micPlayer.stops == 1 && shared.speechID == nil, "Microphone-start helper immediately stops current clip")
for reason in ["background", "interrupted"] {
    let lifecycle = Harness(); _ = speak(lifecycle, reason, text: phrase); finishIO(); let current = lifecycle.speechPlayer!
    let notification = reason == "background" ? Notification(name: UIApplication.didEnterBackgroundNotification) : Notification(name: AVAudioSession.interruptionNotification, userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.began.rawValue])
    lifecycle.suspendAudio(notification); drain()
    expect(current.stops == 1 && events(lifecycle, "speechEnded").last?["reason"] as? String == reason, "\(reason) runs actual immediate player teardown")
    lifecycle.audioPlayerDidFinishPlaying(current, successfully: true); drain(); expect(events(lifecycle, "speechEnded").count == 1, "\(reason) rejects late completion")
}
let ended = Harness(); _ = speak(ended, "interruption-ended", text: phrase); finishIO(); let live = ended.speechPlayer!
ended.suspendAudio(Notification(name: AVAudioSession.interruptionNotification, userInfo: [AVAudioSessionInterruptionTypeKey: AVAudioSession.InterruptionType.ended.rawValue])); drain()
expect(ended.speechPlayer === live && live.stops == 0, "Interruption-ended notification cannot spuriously cancel or restart")
let stopped = Harness(); _ = speak(stopped, "account-language-stop", text: phrase); finishIO(); let stopping = stopped.speechPlayer!
stopped.stopSpeaking(CAPPluginCall("account-language-stop")); drain()
expect(stopping.stops == 1 && events(stopped, "speechEnded").last?["reason"] as? String == "cancelled", "Existing JS stop used on account/language change stops clips too")
Bundle.resource = root.appendingPathComponent("missing-bundle")
let missing = Harness(), rejected = speak(missing, "known-missing", text: phrase); finishIO()
expect(rejected.rejections == ["VOICE_PACK_UNAVAILABLE"] && missing.synthesizer.utterances.isEmpty && events(missing, "speechProgress").isEmpty, "Known missing bundle fails without fallback or invented playback")
Bundle.resource = root
print("PASS: \(checks) production native voice-pack lookup/player/lifecycle checks (host boundaries, no physical audio claim)")
