// Only permission, presentation and Capacitor boundaries are faked. The runner
// injects the real plugin start/resolve/present/discard bodies and options parser.
final class CAPPluginCall {
    let options: [String: Any]
    var resolutions: [[String: Any]] = []
    var rejections: [String] = []
    init(_ options: [String: Any] = [:]) { self.options = options }
    func getString(_ key: String) -> String? { options[key] as? String }
    func getArray(_ key: String) -> [Any]? { options[key] as? [Any] }
    func getObject(_ key: String) -> [String: Any]? { options[key] as? [String: Any] }
    func resolve(_ value: [String: Any] = [:]) { resolutions.append(value) }
    func reject(_ message: String) { rejections.append(message) }
}
enum CaptureFiles {
    static let queue = DispatchQueue(label: "fixlist.test.capture-files")
    static let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    static var failRemove = false
    /* PRODUCTION_VALID_ID */
    static func folder(_ id: String) -> URL { root.appendingPathComponent(id) }
    static func remove(_ url: URL) throws {
        if failRemove { throw NSError(domain: "test-cleanup", code: 1) }
        do { try FileManager.default.removeItem(at: url) }
        catch let e as NSError where e.domain == NSCocoaErrorDomain && e.code == NSFileNoSuchFileError { }
    }
}
enum ARWorldTrackingConfiguration { static var isSupported = true }
enum AVCaptureDevice {
    enum Status { case authorized, denied, restricted, notDetermined }
    static var status = Status.authorized
    static var permissions: [(Bool) -> Void] = []
    static func authorizationStatus(for media: String) -> Status { status }
    static func requestAccess(for media: String, completionHandler: @escaping (Bool) -> Void) { permissions.append(completionHandler) }
}
extension String { static var video: String { "video" } }
final class FakeCaptureView { var window: Bool? = true }
final class FakePresenter {
    var presentedViewController: FixListCaptureViewController?
    var viewIfLoaded: FakeCaptureView? = FakeCaptureView()
    var presentations = 0
    func present(_ controller: FixListCaptureViewController, animated: Bool) {
        presentations += 1; presentedViewController = controller
    }
}
final class FakeBridge { let viewController: FakePresenter? = FakePresenter() }
final class FixListCaptureViewController {
    let completion: ([String: Any]) -> Void
    var aborts = 0
    init(options: CaptureOptions, completion: @escaping ([String: Any]) -> Void) { self.completion = completion }
    // Dismissal can finish later, as UIKit does. Tests explicitly deliver it.
    func abort() { aborts += 1 }
}
final class NativeLifecycleHarness {
    var pendingCall: CAPPluginCall?
    var pendingId: String?
    var activeCapture: FixListCaptureViewController?
    var sharing = false
    var bridge: FakeBridge? = FakeBridge()
    /* PRODUCTION_PLUGIN_METHODS */
}

// These boundaries run the production controller's video/photo lifecycle bodies.
struct LifecyclePhoto {
    let photoId: String
    let url: URL
    var camera: Bool? = true
    var json: [String: Any] { ["photoId": photoId] }
}
final class LifecycleVideoWriter {
    var cancels = 0
    var pendingUse: ((Result<CaptureVideo, Error>) -> Void)?
    func use(generation: UUID, completion: @escaping (Result<CaptureVideo, Error>) -> Void) { pendingUse = completion }
    func discard() { cancels += 1; CaptureFiles.queue.async {} }
}
final class LifecycleCoaching { func setActive(_ active: Bool, animated: Bool) {} }
final class LifecycleAim { var isEnabled = true }
final class LifecyclePreview { var image: Bool? }
typealias ARSession = FakeSession
enum ARError {
    static let errorDomain = "AR-test"
    enum Code: Int { case worldTrackingFailed = 1 }
}
final class CaptureVideoLifecycleHarness {
    enum VideoState { case idle, recording, finishing, reviewing, saving }
    var videoState = VideoState.idle
    var videoGeneration: UUID?
    var videoCommitPending = false
    var acceptedVideo: CaptureVideo?
    var candidateVideo: CaptureVideo?
    var videoNotice: String?
    var videoTimer: Timer?
    let videoWriter = LifecycleVideoWriter()
    var isVideoIdle: Bool { videoState == .idle && !videoCommitPending }
    let options = CaptureOptions(call: CAPPluginCall(nativeOptions("cap-video-state-01")))!
    let createdAt = "2026-10-24T01:02:03.000Z"
    let prompts = [CapturePrompt(checklistItemId: nil, text: "One photo")]
    var promptIndex = 0
    var photos: [LifecyclePhoto] = []
    var pendingPhoto: LifecyclePhoto?
    var saving = false
    var finished = false
    var corners: [SIMD2<Float>] = []
    var doors: [SIMD2<Float>] = []
    var closed = false
    var floorY: Float?
    let aimOverlay = LifecycleAim()
    let coaching = LifecycleCoaching()
    let arView = FakeARView()
    let preview = LifecyclePreview()
    var observers: [NSObjectProtocol] = []
    var interrupted = false
    var trackingNormal = true
    var trackingFailures = 1
    var beganPhotos = false
    var presentedViewController: UIAlertController?
    var pendingDismiss: (() -> Void)?
    var cancellationsAtDismiss = 0
    var outcomes: [[String: Any]] = []
    var removedPhotos = 0
    lazy var completion: ([String: Any]) -> Void = { self.outcomes.append($0) }
    func refresh() {}
    func text(_ key: String) -> String { key }
    func removePendingPhoto() { removedPhotos += 1; pendingPhoto = nil }
    func beginPhotos() { beganPhotos = true }
    func resetWorld() {}
    func advance() { completeCapture() }
    func dismiss(animated: Bool, completion: (() -> Void)? = nil) {
        cancellationsAtDismiss = videoWriter.cancels
        pendingDismiss = completion
    }
    /* PRODUCTION_VIDEO_LIFECYCLE_METHODS */
}
