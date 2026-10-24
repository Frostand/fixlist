// Host-only boundary stubs. Production method bodies are injected by the runner.
// This does not model ARKit tracking, UIView presentation, or physical capture.
// Match the SDK's refined associated-value shape without Equatable conformance.
enum ARPlaneAnchor {
    enum Classification {
        enum Status { case notAvailable, undetermined, unknown }
        case none(Status), wall, floor, ceiling, table, seat, window, door
    }
}
final class UIAlertAction {
    enum Style { case cancel, destructive }
    let style: Style
    let handler: ((UIAlertAction) -> Void)?
    init(title: String, style: Style, handler: ((UIAlertAction) -> Void)? = nil) {
        self.style = style; self.handler = handler
    }
}
final class UIAlertController {
    enum Style { case alert }
    var actions: [UIAlertAction] = []
    init(title: String, message: String, preferredStyle: Style) {}
    func addAction(_ action: UIAlertAction) { actions.append(action) }
}
enum UIAccessibility {
    enum Notification { case announcement }
    static func post(notification: Notification, argument: String) {}
}
struct FakePhoto { var camera: Bool? = true }
struct FakeOverlay { var children = [1] }
final class FakeSession {
    enum Options: Hashable { case resetTracking, removeExistingAnchors }
    var resets = 0
    var delegate: Bool? = true
    func pause() {}
    func run(_ configuration: String, options: Set<Options>) { resets += 1 }
}
struct FakeARView { let session = FakeSession() }
final class CaptureStateHarness {
    enum Step { case floor, outline, photos }
    var step = Step.outline
    var finished = false
    var worldGeneration = 2
    var floorY: Float? = -1.2
    var planeHeights: [UUID: Float] = [UUID(): -1.2]
    var corners = [SIMD2<Float>(0, 0), SIMD2(1, 0), SIMD2(1, 1)]
    var doors = [SIMD2<Float>(0.5, 0)]
    var history = [1, 2, 3]
    var closed = true
    var doorMode = true
    var photos = [FakePhoto()]
    var pendingPhoto: FakePhoto? = FakePhoto()
    var saving = true
    var overlay = FakeOverlay()
    var trackingNormal = true
    var interrupted = true
    var relocalizing = true
    var resetNotice = false
    var presentedViewController: UIAlertController?
    let arView = FakeARView()
    var discardedVideoAttempts = 0
    func discardActiveVideo(showInterrupted: Bool) { discardedVideoAttempts += 1 }
    func configuration() -> String { "horizontal-gravity" }
    func refresh() {}
    func text(_ key: String) -> String { key }
    func present(_ alert: UIAlertController, animated: Bool) { presentedViewController = alert }
    /* PRODUCTION_RESTART_METHODS */
    func receivePhoto(generation: Int) -> FakePhoto {
        var photo = FakePhoto()
        /* PRODUCTION_LATE_PHOTO_GUARD */
        return photo
    }
}
