// Host boundary stubs; the runner injects real production plugin method bodies.
// This checks capability and bridge/state behavior, not generation, capture or audible playback.
import Foundation
private enum AssistantError: Error { case unavailable }
/* PRODUCTION_LOCALES */
enum ModelReason { case appleIntelligenceNotEnabled, deviceNotEligible, modelNotReady }
enum ModelAvailability: Equatable { case available, unavailable(ModelReason) }
final class SystemLanguageModel {
    static let `default` = SystemLanguageModel()
    var availability: ModelAvailability = .available
    var locales: Set<String> = ["en-US"]
    func supportsLocale(_ locale: Locale) -> Bool { locales.contains(locale.identifier) }
}
final class SFSpeechRecognizer {
    enum AuthorizationStatus { case authorized, denied, restricted, notDetermined }
    static var status: AuthorizationStatus = .authorized
    static var local: Set<String> = ["en-US"]
    static var ready: Set<String> = ["en-US"]
    let supportsOnDeviceRecognition: Bool
    let isAvailable: Bool
    init?(locale: Locale) { supportsOnDeviceRecognition = Self.local.contains(locale.identifier); isAvailable = Self.ready.contains(locale.identifier) }
    static func authorizationStatus() -> AuthorizationStatus { status }
}
final class AVSpeechSynthesisVoice {
    struct Quality: Equatable { let rawValue: Int }
    struct Traits: OptionSet {
        let rawValue: Int
        static let isNoveltyVoice = Traits(rawValue: 1)
        static let isPersonalVoice = Traits(rawValue: 2)
    }
    let language: String
    let identifier: String
    let quality: Quality
    let voiceTraits: Traits
    init(_ language: String, id: String = "default", quality: Int = 1, traits: Traits = []) {
        self.language = language; identifier = id; self.quality = Quality(rawValue: quality); voiceTraits = traits
    }
    static var voices = [AVSpeechSynthesisVoice("en-US")]
    static func speechVoices() -> [AVSpeechSynthesisVoice] { voices }
}
/* PRODUCTION_SPEECH_POLICY */

final class FixtureQueue {
    var callbacks: [() -> Void] = []
    var timers: [DispatchWorkItem] = []
    func async(execute: @escaping () -> Void) { callbacks.append(execute) }
    func asyncAfter(deadline: DispatchTime, execute: DispatchWorkItem) { timers.append(execute) }
    func drain() { while !callbacks.isEmpty { callbacks.removeFirst()() } }
}
enum DispatchQueue { static let main = FixtureQueue() }
final class CAPPluginCall {
    let id: String
    let language: String?
    let text: String?
    var results: [[String: Any]] = []
    var rejections: [String] = []
    init(_ id: String, language: String? = nil, text: String? = nil) { self.id = id; self.language = language; self.text = text }
    func getString(_ key: String) -> String? { key == "sessionId" ? id : key == "language" ? language : key == "text" ? text : nil }
    func resolve(_ data: [String: Any] = [:]) { results.append(data) }
    func reject(_ message: String, _ code: String) { rejections.append(code) }
}
final class FakeInput { var removes = 0; func removeTap(onBus: Int) { removes += 1 } }
final class FakeEngine { let inputNode = FakeInput(); var stops = 0; func stop() { stops += 1 } }
final class FakeRequest { var ends = 0; func endAudio() { ends += 1 } }
final class FakeTask { var cancels = 0; func cancel() { cancels += 1 } }
struct FakeResult { let bestTranscription: Transcription; let isFinal: Bool }
struct Transcription { let formattedString: String }
final class FakeRecognizer {
    var callback: ((FakeResult?, Error?) -> Void)?
    func recognitionTask(with: FakeRequest, resultHandler: @escaping (FakeResult?, Error?) -> Void) -> FakeTask {
        callback = resultHandler; return FakeTask()
    }
}
let AVSpeechUtteranceDefaultSpeechRate: Float = 0.5
final class AVSpeechUtterance {
    let speechString: String
    var voice: AVSpeechSynthesisVoice?
    var rate: Float = AVSpeechUtteranceDefaultSpeechRate
    init(string: String = "") { speechString = string }
}
final class AVSpeechSynthesizer {
    enum Boundary { case immediate }
    var stops = 0
    var spoken: [AVSpeechUtterance] = []
    func speak(_ utterance: AVSpeechUtterance) { spoken.append(utterance) }
    func stopSpeaking(at: Boundary) { stops += 1 }
}
enum UIApplication { static let didEnterBackgroundNotification = Notification.Name("background") }
let AVAudioSessionInterruptionTypeKey = "type"
final class AVAudioSession {
    enum RecordPermission { case granted, denied, undetermined }
    static let instance = AVAudioSession()
    var recordPermission: RecordPermission = .granted
    static func sharedInstance() -> AVAudioSession { instance }

    static let interruptionNotification = Notification.Name("interruption")
    enum InterruptionType: UInt { case began = 1, ended = 0 }
}
final class Harness {
    let synthesizer = AVSpeechSynthesizer()
    var speechID: String?, spokenUtterance: AVSpeechUtterance?
    var audioEngine: FakeEngine?, recognitionRequest: FakeRequest?, recognitionTask: FakeTask?, recognizer: FakeRecognizer?
    var transcript = "", listenID: String?, pendingStart: CAPPluginCall?, pendingStops: [CAPPluginCall] = []
    var stopTimer: DispatchWorkItem?, tapInstalled = false
    var restores = 0, events: [(String, [String: Any])] = []
    func configureAudio(recording: Bool) throws {}
    func restoreAudio() { restores += 1 }
    func notifyListeners(_ name: String, data: [String: Any]) { events.append((name, data)) }
    func begin(_ id: String) -> FakeRecognizer {
        listenID = id; transcript = ""; audioEngine = FakeEngine(); tapInstalled = true
        let recognizer = FakeRecognizer(), request = FakeRequest()
        self.recognizer = recognizer; recognitionRequest = request
        /* PRODUCTION_RECOGNITION_CALLBACK */
        return recognizer
    }
    /* PRODUCTION_METHODS */
}
var checks = 0
func expect(_ condition: @autoclosure () -> Bool, _ message: String) {
    checks += 1
    if !condition() { print("FAIL: \(message)"); exit(1) }
}
func event(_ harness: Harness, _ name: String) -> [String: Any] { harness.events.last { $0.0 == name }?.1 ?? [:] }
func drain() { DispatchQueue.main.drain() }
let h = Harness()
let missingLanguage = CAPPluginCall("missing")
h.availability(missingLanguage); drain()
expect(missingLanguage.rejections == ["INVALID_INPUT"], "Availability requires an explicit supported language")
let unsupported = CAPPluginCall("unsupported", language: "ru")
h.availability(unsupported); drain()
expect(unsupported.results.last?["language"] as? String == "ru", "Availability echoes selected language")
expect(unsupported.results.last?["onDeviceModel"] as? Bool == false, "Another language's model support cannot enable selected language")
expect(unsupported.results.last?["speechInput"] as? Bool == false, "Another language's recognizer cannot enable selected language")
expect(unsupported.results.last?["speechOutput"] as? Bool == false, "Another language's voice cannot enable selected language")
SFSpeechRecognizer.local = ["ru-RU"]; SFSpeechRecognizer.ready = ["ru-RU"]
let independent = CAPPluginCall("independent", language: "ru")
h.availability(independent); drain()
expect(independent.results.last?["speechInput"] as? Bool == true && independent.results.last?["onDeviceModel"] as? Bool == false, "Selected speech input is independent of generation")
SFSpeechRecognizer.ready = []
let notReady = CAPPluginCall("not-ready", language: "ru")
h.availability(notReady); drain()
expect(notReady.results.last?["speechInput"] as? Bool == false, "Unavailable recognizer is not ready even with on-device support")
SystemLanguageModel.default.availability = .unavailable(.appleIntelligenceNotEnabled)
let disabled = CAPPluginCall("disabled", language: "en")
h.availability(disabled); drain()
expect(disabled.results.last?["reason"] as? String == "apple-intelligence-not-enabled", "Model reason is an explicit stable bridge code")
expect(disabled.results.last?["speechOutput"] as? Bool == true, "Installed selected voice remains available when generation is disabled")
SystemLanguageModel.default.availability = .available

// Synthetic metadata, varied for every app language; never a device support list.
for (language, locale) in assistantLocales {
    SystemLanguageModel.default.locales = [locale]
    SFSpeechRecognizer.local = []; SFSpeechRecognizer.ready = []
    AVSpeechSynthesisVoice.voices = []
    let modelOnly = CAPPluginCall("model-only", language: language)
    h.availability(modelOnly); drain()
    expect(modelOnly.results.last?["onDeviceModel"] as? Bool == true && modelOnly.results.last?["reason"] == nil, "Selected supported/ready model is available for \(language)")
    expect(modelOnly.results.last?["speechInput"] as? Bool == false && modelOnly.results.last?["speechOutput"] as? Bool == false, "Generation never implies audio for \(language)")
    SFSpeechRecognizer.local = [locale]; SFSpeechRecognizer.ready = [locale]
    AVSpeechSynthesisVoice.voices = [AVSpeechSynthesisVoice(locale)]
    SFSpeechRecognizer.status = .denied
    let denied = CAPPluginCall("denied", language: language)
    h.availability(denied); drain()
    expect(denied.results.last?["speechInput"] as? Bool == false && denied.results.last?["speechInputReason"] as? String == "permission-denied", "Speech permission blocks only input for \(language)")
    expect(denied.results.last?["onDeviceModel"] as? Bool == true && denied.results.last?["speechOutput"] as? Bool == true, "Output and generation remain independent of denied input for \(language)")
    SFSpeechRecognizer.status = .authorized
}
// Synthetic installed-voice metadata, executing the production speak/availability paths.
let voiceHarness = Harness()
let basic = AVSpeechSynthesisVoice("en-US", id: "basic")
let enhanced = AVSpeechSynthesisVoice("en-US", id: "enhanced", quality: 2)
let premium = AVSpeechSynthesisVoice("en-GB", id: "premium", quality: 3)
AVSpeechSynthesisVoice.voices = [basic, enhanced, premium]
let spoken = CAPPluginCall("voice", language: "en", text: "I've drafted that for you.")
voiceHarness.speak(spoken); drain()
expect(voiceHarness.spokenUtterance?.voice === premium, "Prefer an installed premium same-language voice over lower quality")
expect(voiceHarness.spokenUtterance?.rate == AVSpeechUtteranceDefaultSpeechRate, "Use the natural system rate without age-based slowdown")
expect(voiceHarness.spokenUtterance?.speechString == "I've drafted that for you." && spoken.results.count == 1, "Speak the conversation without adding capability labels")
let exactPremium = AVSpeechSynthesisVoice("en-US", id: "premium-us", quality: 3)
AVSpeechSynthesisVoice.voices = [premium, exactPremium]
voiceHarness.speak(CAPPluginCall("exact", language: "en", text: "Got it.")); drain()
expect(voiceHarness.spokenUtterance?.voice === exactPremium, "Requested region breaks equal-quality ties")
let tieA = AVSpeechSynthesisVoice("en-US", id: "a", quality: 2)
let tieB = AVSpeechSynthesisVoice("en-US", id: "b", quality: 2)
for voices in [[tieA, tieB], [tieB, tieA]] {
    AVSpeechSynthesisVoice.voices = voices
    voiceHarness.speak(CAPPluginCall("stable", language: "en", text: "Got it.")); drain()
    expect(voiceHarness.spokenUtterance?.voice === tieA, "Equal-quality choice is stable across inventory order")
}
for voice in [enhanced, basic] {
    AVSpeechSynthesisVoice.voices = [voice]
    voiceHarness.speak(CAPPluginCall("fallback", language: "en", text: "Got it.")); drain()
    expect(voiceHarness.spokenUtterance?.voice === voice, "An installed lower-quality matching voice is an honest fallback")
}
let novelty = AVSpeechSynthesisVoice("en-US", id: "novelty", quality: 3, traits: .isNoveltyVoice)
let personal = AVSpeechSynthesisVoice("en-US", id: "personal", quality: 3, traits: .isPersonalVoice)
AVSpeechSynthesisVoice.voices = [novelty, personal, basic]
voiceHarness.speak(CAPPluginCall("ordinary", language: "en", text: "Got it.")); drain()
expect(voiceHarness.spokenUtterance?.voice === basic, "Assistant uses an ordinary voice rather than a character or someone's Personal Voice")
for voices in [[], [AVSpeechSynthesisVoice("fr-FR")], [novelty, personal]] {
    AVSpeechSynthesisVoice.voices = voices
    let availability = CAPPluginCall("missing-voice", language: "en")
    voiceHarness.availability(availability); drain()
    expect(availability.results.last?["speechOutput"] as? Bool == false && availability.results.last?["speechOutputReason"] as? String == "voice-unavailable", "Availability uses the same eligible installed inventory as speak")
    let unavailable = CAPPluginCall("no-fallback", language: "en", text: "Hello")
    let count = voiceHarness.synthesizer.spoken.count
    voiceHarness.speak(unavailable); drain()
    expect(unavailable.rejections == ["UNAVAILABLE"] && voiceHarness.synthesizer.spoken.count == count, "No matching installed voice rejects without another language or fabricated download")
}
let first = h.begin("first")
first.callback?(FakeResult(bestTranscription: Transcription(formattedString: "Move this chair"), isFinal: false), nil); drain()
expect(event(h, "partial")["sessionId"] as? String == "first", "Real partial callback includes the client session ID")
first.callback?(FakeResult(bestTranscription: Transcription(formattedString: "Move this chair please"), isFinal: true), nil); drain()
expect(event(h, "listeningEnded")["reason"] as? String == "final", "Natural final emits the terminal event")
expect(event(h, "listeningEnded")["text"] as? String == "Move this chair please", "Natural final carries final text")
expect(h.listenID == nil && h.audioEngine == nil, "Natural final releases microphone state")
let restores = h.restores, events = h.events.count
first.callback?(nil, NSError(domain: "late", code: 1)); drain()
expect(h.restores == restores && h.events.count == events, "Late recognition callbacks do not emit twice or restore audio again")
for (name, expected) in [(UIApplication.didEnterBackgroundNotification, "background"), (AVAudioSession.interruptionNotification, "interrupted")] {
    _ = h.begin(expected); h.transcript = "Recover these partial words"
    h.suspendAudio(Notification(name: name)); drain()
    let end = event(h, "listeningEnded")
    expect(end["sessionId"] as? String == expected && end["reason"] as? String == expected, "Notification wires the actual terminal reason and session")
    expect(end["text"] as? String == "Recover these partial words", "Notification preserves the transcript before releasing audio")
}
let failed = h.begin("failed")
failed.callback?(FakeResult(bestTranscription: Transcription(formattedString: "Partial before error"), isFinal: false), NSError(domain: "speech", code: 2)); drain()
expect(event(h, "listeningEnded")["reason"] as? String == "error" && event(h, "listeningEnded")["text"] as? String == "Partial before error", "Actual error callback terminates with recoverable text")
let stopping = h.begin("stopping")
h.transcript = "Stop words"
let stop1 = CAPPluginCall("stopping"), stop2 = CAPPluginCall("stopping")
h.stopListening(stop1); h.stopListening(stop2); drain()
expect(h.pendingStops.count == 2 && h.stopTimer != nil, "Repeated stops wait on the same native session")
let oldTimeout = h.stopTimer!
stopping.callback?(FakeResult(bestTranscription: Transcription(formattedString: "Final stop words"), isFinal: true), nil); drain()
expect(stop1.results.count == 1 && stop2.results.count == 1, "Each repeated stop resolves exactly once")
expect(stop1.results[0]["text"] as? String == "Final stop words" && stop1.results[0]["reason"] as? String == "stopped", "Stop response carries the same ID, reason and text as terminal")
_ = h.begin("new-input")
let restoreBeforeOld = h.restores, countBeforeOld = h.events.count
h.cancelListening(CAPPluginCall("stopping")); h.stopListening(CAPPluginCall("stopping")); oldTimeout.perform(); drain()
expect(h.listenID == "new-input" && h.restores == restoreBeforeOld && h.events.count == countBeforeOld, "Old cancel/stop/timeout cannot release or restore newer input")
h.suspendAudio(Notification(name: AVAudioSession.interruptionNotification, userInfo: [AVAudioSessionInterruptionTypeKey: UInt(0)])); drain()
expect(h.listenID == "new-input", "Interruption-ended notification does not cancel a new session")
h.pendingStart = CAPPluginCall("new-input")
let pending = h.pendingStart!
h.cancelListening(CAPPluginCall("new-input")); h.cancelListening(CAPPluginCall("new-input")); drain()
expect(pending.rejections == ["CANCELLED"] && h.listenID == nil, "Cancel during permission startup settles startup once")
let oldUtterance = AVSpeechUtterance(); h.speechID = "output-old"; h.spokenUtterance = oldUtterance
h.speechSynthesizer(h.synthesizer, didStart: oldUtterance); drain()
expect(event(h, "speechProgress")["stage"] as? String == "started" && event(h, "speechProgress")["sessionId"] as? String == "output-old", "Real didStart delegate wires progress and ID")
h.speechSynthesizer(h.synthesizer, willSpeakRangeOfSpeechString: NSRange(location: 0, length: 4), utterance: oldUtterance); drain()
expect(event(h, "speechProgress")["stage"] as? String == "word", "Real word delegate drives the inactivity watchdog")
h.stopSpeaking(CAPPluginCall("output-old")); drain()
let newUtterance = AVSpeechUtterance(); h.speechID = "output-new"; h.spokenUtterance = newUtterance
let restoresBeforeSpeech = h.restores, speechEvents = h.events.count
h.stopSpeaking(CAPPluginCall("output-old"))
h.speechSynthesizer(h.synthesizer, didFinish: oldUtterance)
h.speechSynthesizer(h.synthesizer, didCancel: oldUtterance)
h.speechSynthesizer(h.synthesizer, didStart: oldUtterance); drain()
expect(h.speechID == "output-new" && h.spokenUtterance === newUtterance && h.restores == restoresBeforeSpeech && h.events.count == speechEvents, "Old output stop/delegates cannot stop, restore or complete newer output")
h.speechSynthesizer(h.synthesizer, didFinish: newUtterance); drain()
expect(event(h, "speechEnded")["sessionId"] as? String == "output-new" && event(h, "speechEnded")["reason"] as? String == "completed", "Real finish delegate emits terminal fields")
print("PASS: \(checks) production native assistant bridge/state checks (host boundaries; no microphone/playback claim)")
