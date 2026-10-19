import ARKit
import os.log
import RealityKit
import UIKit

/// One portrait-only, offline AR session. Session callbacks and UI state live on
/// the main queue; pixel conversion and cache operations use CaptureFiles.queue.
final class FixListCaptureViewController: UIViewController, ARSessionDelegate {
    private enum Step { case floor, outline, photos }
    private enum Mark { case corner, door }
    private let options: CaptureOptions
    private let completion: ([String: Any]) -> Void
    private let createdAt = CaptureFiles.timestamp()
    private let arView = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
    private let overlay = AnchorEntity(world: .zero)
    private let statusLabel = UILabel()
    private let resetLabel = UILabel()
    private let promptLabel = UILabel()
    private let countLabel = UILabel()
    private let preview = UIImageView()
    private let buttons = UIStackView()
    private var undoButton = UIButton()
    private var closeButton = UIButton()
    private var doorButton = UIButton()
    private var skipOutlineButton = UIButton()
    private var resetButton = UIButton()
    private var shutterButton = UIButton()
    private var retakeButton = UIButton()
    private var skipButton = UIButton()
    private var nextButton = UIButton()
    private var step = Step.floor
    private var floorY: Float?
    private var planeHeights: [UUID: Float] = [:]
    private var corners: [SIMD2<Float>] = []
    private var doors: [SIMD2<Float>] = []
    private var history: [Mark] = []
    private var closed = false
    private var doorMode = false
    private var trackingNormal = false
    private var interrupted = false
    private var relocalizing = false
    private var resetNotice = false
    private var worldGeneration = 0
    private var trackingFailures = 0
    private var promptIndex = 0
    private var photos: [CapturePhoto] = []
    private var pendingPhoto: CapturePhoto?
    private var saving = false
    private var finished = false
    private var observers: [NSObjectProtocol] = []
    private var lastStatus = ""

    // The contract permits zero prompts but requires >=1 completed photo. Offer
    // one unlinked extra photo, labelled with the supplied room name, in that case.
    private var prompts: [CapturePrompt] {
        options.prompts.isEmpty ? [CapturePrompt(checklistItemId: nil, text: options.roomName)] : options.prompts
    }

    init(options: CaptureOptions, completion: @escaping ([String: Any]) -> Void) {
        self.options = options
        self.completion = completion
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
        isModalInPresentation = true
    }
    required init?(coder: NSCoder) { fatalError("Use init(options:completion:)") }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .portrait }
    override var shouldAutorotate: Bool { false }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    deinit { observers.forEach(NotificationCenter.default.removeObserver) }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        arView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(arView)
        NSLayoutConstraint.activate([
            arView.leadingAnchor.constraint(equalTo: view.leadingAnchor), arView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            arView.topAnchor.constraint(equalTo: view.topAnchor), arView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        // Disable ARView's automatic configuration: only the explicit horizontal
        // plane configuration below may run, with no depth or reconstruction.
        arView.session.delegateQueue = .main
        arView.session.delegate = self
        arView.scene.addAnchor(overlay)
        arView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped(_:))))
        arView.isAccessibilityElement = true
        arView.accessibilityLabel = text("tapCorners")
        arView.accessibilityCustomActions = [UIAccessibilityCustomAction(name: text("tapCorners"), target: self,
                                                                       selector: #selector(placeAtCenter))]

        preview.translatesAutoresizingMaskIntoConstraints = false
        preview.contentMode = .scaleAspectFit
        preview.backgroundColor = .black
        preview.isHidden = true
        preview.isAccessibilityElement = true
        preview.accessibilityLabel = text("retake")
        view.addSubview(preview)
        NSLayoutConstraint.activate([
            preview.leadingAnchor.constraint(equalTo: view.leadingAnchor), preview.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            preview.topAnchor.constraint(equalTo: view.topAnchor), preview.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        makeControls()
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
                guard let self = self, !self.finished else { return }
                self.interrupted = true
                self.trackingNormal = false
                self.arView.session.pause()
                self.refresh()
            },
            center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                guard let self = self, !self.finished, self.view.window != nil else { return }
                // No reset: ask ARKit to recover the SAME world frame.
                self.arView.session.run(self.configuration())
            }
        ]
        refresh()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !finished else { return }
        arView.session.run(configuration())
    }

    private func configuration() -> ARWorldTrackingConfiguration {
        let configuration = ARWorldTrackingConfiguration()
        configuration.worldAlignment = .gravity
        configuration.planeDetection = [.horizontal]
        configuration.environmentTexturing = .none
        configuration.isAutoFocusEnabled = true
        return configuration
    }

    private func text(_ key: String) -> String { options.strings[key] ?? CaptureOptions.english[key] ?? key }
    private func label(_ key: String, size: CGFloat = 18, weight: UIFont.Weight = .regular) -> UILabel {
        let label = UILabel()
        label.text = text(key)
        label.textColor = .white
        label.numberOfLines = 0
        label.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: size, weight: weight))
        label.adjustsFontForContentSizeCategory = true
        return label
    }
    private func styleLabel(_ label: UILabel) {
        label.textColor = .white
        label.numberOfLines = 0
        label.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 18, weight: .semibold))
        label.adjustsFontForContentSizeCategory = true
    }
    private func button(_ key: String, action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(text(key), for: .normal)
        button.accessibilityLabel = text(key)
        button.titleLabel?.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 18, weight: .semibold))
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.titleLabel?.numberOfLines = 0
        button.titleLabel?.textAlignment = .center
        button.setTitleColor(.white, for: .normal)
        button.setTitleColor(.lightGray, for: .disabled)
        button.backgroundColor = UIColor(red: 0.08, green: 0.20, blue: 0.42, alpha: 1)
        button.layer.cornerRadius = 8
        // Use configuration instead of deprecated contentEdgeInsets (iOS 15+).
        var configuration = UIButton.Configuration.plain()
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 12, bottom: 12, trailing: 12)
        button.configuration = configuration
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
        button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    private func panel(_ stack: UIStackView, top: Bool) {
        let scroll = UIScrollView()
        scroll.backgroundColor = UIColor(white: 0.035, alpha: 0.97)
        scroll.layer.cornerRadius = 12
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        stack.axis = .vertical
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        let desiredHeight = scroll.heightAnchor.constraint(equalTo: stack.heightAnchor, constant: 24)
        desiredHeight.priority = .defaultHigh
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
            scroll.heightAnchor.constraint(lessThanOrEqualTo: view.safeAreaLayoutGuide.heightAnchor, multiplier: top ? 0.32 : 0.50),
            desiredHeight,
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 12),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -12),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 12),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -12),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -24)
        ])
        if top { scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4).isActive = true }
        else { scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -4).isActive = true }
    }

    private func makeControls() {
        let heading = UIStackView()
        let cancel = button("cancel", action: #selector(cancelTapped))
        let room = label("approximate", size: 22, weight: .bold)
        room.text = options.roomName
        room.accessibilityTraits = .header
        styleLabel(statusLabel)
        styleLabel(resetLabel)
        resetLabel.text = text("relocalizeFailed")
        heading.addArrangedSubview(cancel)
        heading.addArrangedSubview(room)
        heading.addArrangedSubview(label("approximate", size: 16))
        heading.addArrangedSubview(statusLabel)
        heading.addArrangedSubview(resetLabel)
        panel(heading, top: true)

        styleLabel(promptLabel)
        styleLabel(countLabel)
        buttons.addArrangedSubview(countLabel)
        buttons.addArrangedSubview(promptLabel)
        undoButton = button("undo", action: #selector(undoTapped))
        closeButton = button("closeOutline", action: #selector(closeTapped))
        doorButton = button("markDoor", action: #selector(doorTapped))
        skipOutlineButton = button("skipOutline", action: #selector(skipOutlineTapped))
        resetButton = button("skipOutline", action: #selector(resetTapped))
        resetButton.accessibilityHint = text("relocalizeFailed")
        shutterButton = button("shutter", action: #selector(shutterTapped))
        retakeButton = button("retake", action: #selector(retakeTapped))
        skipButton = button("skip", action: #selector(skipTapped))
        nextButton = button("next", action: #selector(nextTapped))
        for button in [undoButton, closeButton, doorButton, skipOutlineButton, resetButton,
                       shutterButton, retakeButton, skipButton, nextButton] { buttons.addArrangedSubview(button) }
        panel(buttons, top: false)
    }

    private func refresh() {
        guard isViewLoaded, !finished else { return }
        let isPhotos = step == .photos
        let isOutline = step == .outline
        let hasPhoto = pendingPhoto != nil
        let status: String
        if interrupted { status = text("interrupted") }
        else if !trackingNormal { status = text("trackingLimited") }
        else if step == .floor { status = text("findFloor") }
        else if isOutline { status = (doorMode ? text("doorMode") : text("floorFound") + " " + text("tapCorners")) }
        else { status = text("photoProgress").replacingOccurrences(of: "{current}", with: String(promptIndex + 1))
                .replacingOccurrences(of: "{total}", with: String(prompts.count)) }
        statusLabel.text = status
        if status != lastStatus {
            lastStatus = status
            UIAccessibility.post(notification: .announcement, argument: status)
        }
        resetLabel.isHidden = !resetNotice
        countLabel.isHidden = !isOutline
        countLabel.text = text("cornerCount").replacingOccurrences(of: "{count}", with: String(corners.count))
        promptLabel.isHidden = !isPhotos
        if isPhotos { promptLabel.text = prompts[promptIndex].text }
        undoButton.isHidden = !isOutline
        undoButton.isEnabled = !history.isEmpty
        closeButton.isHidden = !isOutline
        closeButton.isEnabled = corners.count >= 3 && trackingNormal && !interrupted
        doorButton.isHidden = !isOutline
        doorButton.isSelected = doorMode
        doorButton.isEnabled = trackingNormal && !interrupted && doors.count < 8
        doorButton.setTitle(text(doorMode ? "doorMode" : "markDoor"), for: .normal)
        doorButton.accessibilityLabel = text(doorMode ? "doorMode" : "markDoor")
        skipOutlineButton.isHidden = isPhotos || relocalizing
        resetButton.isHidden = !relocalizing
        shutterButton.isHidden = !isPhotos || hasPhoto
        shutterButton.isEnabled = trackingNormal && !interrupted && !saving
        retakeButton.isHidden = !isPhotos || !hasPhoto
        retakeButton.isEnabled = !saving
        skipButton.isHidden = !isPhotos
        skipButton.isEnabled = !saving
        nextButton.isHidden = !isPhotos
        nextButton.isEnabled = !saving && (hasPhoto || (promptIndex == prompts.count - 1 && !photos.isEmpty))
        let nextKey = promptIndex == prompts.count - 1 ? "done" : "next"
        nextButton.setTitle(text(nextKey), for: .normal)
        nextButton.accessibilityLabel = text(nextKey)
        arView.isAccessibilityElement = !isPhotos
        preview.isHidden = !hasPhoto
    }

    @objc private func tapped(_ gesture: UITapGestureRecognizer) { place(at: gesture.location(in: arView)) }
    @objc private func placeAtCenter() -> Bool {
        place(at: CGPoint(x: arView.bounds.midX, y: arView.bounds.midY))
        return true
    }
    private func place(at point: CGPoint) {
        guard step == .outline, trackingNormal, !interrupted, let floor = floorY, !finished,
              let query = arView.makeRaycastQuery(from: point, allowing: .existingPlaneInfinite, alignment: .horizontal)
                ?? arView.makeRaycastQuery(from: point, allowing: .estimatedPlane, alignment: .horizontal) else { return }
        guard let result = arView.session.raycast(query).first(where: { abs($0.worldTransform[3].y - floor) <= 0.15 }) else { return }
        let position = SIMD2(result.worldTransform[3].x, result.worldTransform[3].z)
        guard position.x.isFinite, position.y.isFinite, abs(position.x) <= 50, abs(position.y) <= 50 else { return }
        if doorMode {
            guard doors.count < 8 else { return }
            doors.append(position)
            history.append(.door)
            doorMode = false
        } else {
            guard corners.count < 32,
                  corners.last.map({ simd_distance($0, position) >= 0.03 }) ?? true,
                  corners.first.map({ corners.count < 2 || simd_distance($0, position) >= 0.03 }) ?? true else { return }
            corners.append(position)
            history.append(.corner)
        }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        drawOutline()
        refresh()
        UIAccessibility.post(notification: .announcement, argument: countLabel.text)
    }

    private func drawOutline() {
        overlay.children.removeAll()
        guard let floor = floorY else { return }
        func sphere(_ point: SIMD2<Float>, color: UIColor, radius: Float) {
            let marker = ModelEntity(mesh: .generateSphere(radius: radius), materials: [UnlitMaterial(color: color)])
            marker.position = SIMD3(point.x, floor + 0.025, point.y)
            overlay.addChild(marker)
        }
        corners.forEach { sphere($0, color: .white, radius: 0.035) }
        doors.forEach { sphere($0, color: .yellow, radius: 0.065) }
        var edges = Array(zip(corners, corners.dropFirst()))
        if closed, let first = corners.first, let last = corners.last { edges.append((last, first)) }
        for (a, b) in edges {
            let start = SIMD3(a.x, floor + 0.02, a.y), end = SIMD3(b.x, floor + 0.02, b.y)
            let length = simd_distance(start, end)
            guard length > 0.001 else { continue }
            let segment = ModelEntity(mesh: .generateBox(size: SIMD3(0.018, 0.018, length)),
                                      materials: [UnlitMaterial(color: .white)])
            segment.position = (start + end) / 2
            segment.orientation = simd_quatf(from: SIMD3(0, 0, 1), to: simd_normalize(end - start))
            overlay.addChild(segment)
        }
    }

    @objc private func undoTapped() {
        guard let mark = history.popLast(), !finished else { return }
        switch mark { case .corner: corners.removeLast(); case .door: doors.removeLast() }
        closed = false
        drawOutline()
        refresh()
    }
    @objc private func doorTapped() { doorMode.toggle(); refresh() }
    @objc private func closeTapped() {
        guard corners.count >= 3, trackingNormal, !interrupted else { return }
        closed = true
        drawOutline()
        beginPhotos()
    }
    @objc private func skipOutlineTapped() {
        corners.removeAll(); doors.removeAll(); history.removeAll(); closed = false
        drawOutline()
        beginPhotos()
    }
    private func beginPhotos() {
        step = .photos
        doorMode = false
        refresh()
        UIAccessibility.post(notification: .screenChanged, argument: promptLabel)
    }

    @objc private func shutterTapped() {
        guard step == .photos, trackingNormal, !interrupted, !saving, pendingPhoto == nil, !finished,
              let frame = arView.session.currentFrame, case .normal = frame.camera.trackingState else { return }
        saving = true
        let generation = worldGeneration
        let id = String(format: "p%02d", photos.count + 1)
        let item = prompts[promptIndex].checklistItemId
        let time = CaptureFiles.timestamp()
        refresh()
        CaptureFiles.queue.async {
            do {
                let (written, bytes) = try CapturePhotoWriter.write(frame: frame, options: self.options, photoId: id,
                                                                   checklistItemId: item, takenAt: time)
                DispatchQueue.main.async {
                    guard !self.finished else { return }
                    var photo = written
                    // A reset may have occurred while JPEG encoding was running.
                    if generation != self.worldGeneration { photo.camera = nil }
                    self.pendingPhoto = photo
                    self.saving = false
                    self.preview.image = UIImage(data: bytes)
                    self.preview.accessibilityLabel = self.prompts[self.promptIndex].text
                    self.refresh()
                    UIAccessibility.post(notification: .screenChanged, argument: self.retakeButton)
                }
            } catch {
                DispatchQueue.main.async {
                    self.finish(["status": "failed", "reason": "photo-write-failed"], keepFiles: false)
                }
            }
        }
    }
    private func removePendingPhoto() {
        if let photo = pendingPhoto { CaptureFiles.queue.async { try? CaptureFiles.remove(photo.url) } }
        pendingPhoto = nil
        preview.image = nil
    }
    @objc private func retakeTapped() { guard !saving else { return }; removePendingPhoto(); refresh() }
    @objc private func skipTapped() {
        guard !saving else { return }
        // Skipping the final prompt with no retained photos closes as a benign
        // cancellation. Never emit an empty/invalid completed manifest.
        if promptIndex == prompts.count - 1 && photos.isEmpty {
            removePendingPhoto()
            abort()
            return
        }
        removePendingPhoto()
        advance()
    }
    @objc private func nextTapped() {
        guard !saving, !finished else { return }
        if let photo = pendingPhoto {
            photos.append(photo)
            pendingPhoto = nil
            preview.image = nil
        } else if promptIndex != prompts.count - 1 || photos.isEmpty { return }
        advance()
    }
    private func advance() {
        if promptIndex < prompts.count - 1 {
            promptIndex += 1
            refresh()
            UIAccessibility.post(notification: .screenChanged, argument: promptLabel)
        } else { completeCapture() }
    }

    private func completeCapture() {
        guard !photos.isEmpty, photos.count <= 40 else { return }
        let outline: Any = corners.count >= 3 ? ["closed": closed, "points": corners.map { [Double($0.x), Double($0.y)] }] : NSNull()
        let result: [String: Any] = [
            "format": "fixlist-room-capture", "version": 1, "captureId": options.captureId,
            "roomId": options.roomId, "createdAt": createdAt, "mode": "arkit",
            "floorY": floorY.map { Double($0) } as Any? ?? NSNull(), "outline": outline,
            "doors": doors.map { [Double($0.x), Double($0.y)] }, "photos": photos.map(\.json),
            "files": Dictionary(uniqueKeysWithValues: photos.map { ($0.photoId, $0.url.absoluteString) })
        ]
        finish(["status": "completed", "capture": result], keepFiles: true)
    }

    @objc private func cancelTapped() {
        guard !finished else { return }
        guard !photos.isEmpty || pendingPhoto != nil || saving else { abort(); return }
        let alert = UIAlertController(title: text("cancelConfirmTitle"), message: text("cancelConfirmMessage"), preferredStyle: .alert)
        let keep = UIAlertAction(title: text("cancelConfirmKeep"), style: .cancel)
        keep.accessibilityLabel = text("cancelConfirmKeep")
        alert.addAction(keep)
        let stop = UIAlertAction(title: text("cancelConfirmStop"), style: .destructive) { [weak self] _ in self?.abort() }
        stop.accessibilityLabel = text("cancelConfirmStop")
        alert.addAction(stop)
        present(alert, animated: true)
    }
    func abort() { finish(["status": "cancelled"], keepFiles: false) }
    private func finish(_ outcome: [String: Any], keepFiles: Bool) {
        guard !finished else { return }
        finished = true
        arView.session.pause()
        arView.session.delegate = nil
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
        let closed = {
            if keepFiles { self.completion(outcome) }
            else {
                CaptureFiles.queue.async {
                    do { try CaptureFiles.remove(CaptureFiles.folder(self.options.captureId)) }
                    catch { os_log("FixListCapture cancelled cache cleanup failed", log: captureLog, type: .error) }
                    DispatchQueue.main.async { self.completion(outcome) }
                }
            }
        }
        // Dismiss a cancellation alert first if reset/discard arrives while it is
        // open, then the entire capture. The promise is resolved exactly once.
        if presentedViewController != nil {
            dismiss(animated: false) { self.dismiss(animated: true, completion: closed) }
        } else { dismiss(animated: true, completion: closed) }
    }

    @objc private func resetTapped() { resetWorld() }
    private func resetWorld() {
        guard !finished else { return }
        worldGeneration += 1
        floorY = nil
        planeHeights.removeAll()
        corners.removeAll(); doors.removeAll(); history.removeAll(); closed = false; doorMode = false
        for index in photos.indices { photos[index].camera = nil }
        pendingPhoto?.camera = nil
        overlay.children.removeAll()
        trackingNormal = false
        interrupted = false
        relocalizing = false
        resetNotice = true
        if step != .photos { step = .floor }
        arView.session.run(configuration(), options: [.resetTracking, .removeExistingAnchors])
        refresh()
        UIAccessibility.post(notification: .announcement, argument: text("relocalizeFailed"))
    }

    func sessionShouldAttemptRelocalization(_ session: ARSession) -> Bool { true }
    func sessionWasInterrupted(_ session: ARSession) {
        guard !finished else { return }
        interrupted = true
        trackingNormal = false
        refresh()
    }
    func sessionInterruptionEnded(_ session: ARSession) {
        guard !finished else { return }
        interrupted = false
        refresh()
    }
    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard !finished else { return }
        var normal = false, recovering = false
        switch frame.camera.trackingState {
        case .normal: normal = true
        case .limited(.relocalizing): recovering = true
        default: break
        }
        if normal != trackingNormal || recovering != relocalizing || (normal && interrupted) {
            trackingNormal = normal
            relocalizing = recovering
            if normal { interrupted = false }
            refresh()
        }
    }
    func session(_ session: ARSession, didAdd anchors: [ARAnchor]) { updatePlanes(anchors) }
    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) { updatePlanes(anchors) }
    func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
        for anchor in anchors { planeHeights.removeValue(forKey: anchor.identifier) }
        updatePlanes([])
    }
    private func updatePlanes(_ anchors: [ARAnchor]) {
        guard !finished else { return }
        for case let plane as ARPlaneAnchor in anchors where plane.alignment == .horizontal {
            let y = plane.transform[3].y + plane.center.y
            if y.isFinite, abs(y) <= 50 { planeHeights[plane.identifier] = y }
        }
        guard let lowest = planeHeights.values.min() else { return }
        let first = floorY == nil
        floorY = lowest
        if step == .floor { step = .outline }
        if first {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            UIAccessibility.post(notification: .announcement, argument: text("floorFound"))
        }
        drawOutline()
        refresh()
    }
    func session(_ session: ARSession, didFailWithError error: Error) {
        guard !finished else { return }
        let failure = error as NSError
        if failure.domain == ARError.errorDomain, failure.code == ARError.Code.worldTrackingFailed.rawValue, trackingFailures == 0 {
            trackingFailures += 1
            resetWorld()
        } else { finish(["status": "failed", "reason": "ar-session-failed"], keepFiles: false) }
    }
}
