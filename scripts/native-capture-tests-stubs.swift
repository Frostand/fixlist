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
    /* PRODUCTION_VALID_ID */
    static func folder(_ id: String) -> URL { root.appendingPathComponent(id) }
    static func remove(_ url: URL) throws {
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
