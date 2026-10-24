import ARKit
import AVKit
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
    private let arView: ARView
    private var cameraImageResolution: CGSize?
    private var viewportAvailableBounds: CGRect?
    private let overlay = AnchorEntity(world: .zero)
    // Transient aiming geometry never enters the saved outline or its history.
    private let aimOverlay = AnchorEntity(world: .zero)
    private let aimRing = Entity()
    private let aimLine = ModelEntity(mesh: .generateBox(size: SIMD3(0.009, 0.006, 1)),
                                      materials: [UnlitMaterial(color: .white)])
    private let coaching = ARCoachingOverlayView()
    private let statusLabel = UILabel()
    private let promptLabel = UILabel()
    private let stepLabel = UILabel()
    private let countLabel = UILabel()
    private let doorChip = UILabel()
    private let instructionIcon = UIImageView()
    private let reticle = UIImageView()
    private let preview = UIImageView()
    private let topChrome = UIStackView()
    private let bottomBar = UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterialDark))
    private let outlineControls = UIView()
    private let photoControls = UIView()
    private let reviewControls = UIStackView()
    private var undoButton = UIButton()
    private var closeButton = UIButton()
    private var addButton = UIButton()
    private var menuButton = UIButton()
    private var shutterButton = UIButton()
    private var retakeButton = UIButton()
    private var skipButton = UIButton()
    private var nextButton = UIButton()
    private enum VideoState { case idle, recording, finishing, reviewing, saving }
    private var videoState = VideoState.idle
    private var videoGeneration: UUID?
    private var videoCommitPending = false
    private var acceptedVideo: CaptureVideo?
    private var candidateVideo: CaptureVideo?
    private var videoNotice: String?
    private var videoTimer: Timer?
    private var videoStarted = 0.0
    private let videoControls = UIStackView()
    private let videoSpinner = UIActivityIndicatorView(style: .medium)
    private var recordVideoButton = UIButton()
    private var stopVideoButton = UIButton()
    private var reviewVideoButton = UIButton()
    private var retakeVideoButton = UIButton()
    private var useVideoButton = UIButton()
    private lazy var videoWriter = CaptureVideoWriter(directory: CaptureFiles.folder(options.captureId)) { [weak self] id, event in
        guard let self = self, !self.finished, self.videoGeneration == id else { return }
        switch event {
        case .finishing:
            self.videoState = .finishing
            self.videoTimer?.invalidate()
        case .review(let video):
            self.videoState = .reviewing
            self.candidateVideo = video
            self.videoNotice = nil
        case .failed:
            self.videoState = .idle
            self.videoGeneration = nil
            self.candidateVideo = nil
            self.videoNotice = self.text("videoFailed")
            self.videoTimer?.invalidate()
        }
        self.refresh()
    }
    private var aimPosition: SIMD2<Float>?
    #if DEBUG && targetEnvironment(simulator)
    private var uiPreviewState = 0
    private var uiPreviewHasPhoto = false
    private let uiPreviewGradient = CAGradientLayer()
    #endif
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
        #if DEBUG && targetEnvironment(simulator)
        arView = ARView(frame: .zero, cameraMode: CaptureUIPreview.enabled ? .nonAR : .ar,
                        automaticallyConfigureSession: false)
        #else
        arView = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
        #endif
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .fullScreen
        isModalInPresentation = true
    }
    required init?(coder: NSCoder) { fatalError("Use init(options:completion:)") }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
    override var preferredInterfaceOrientationForPresentation: UIInterfaceOrientation { .portrait }
    override var shouldAutorotate: Bool { false }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    deinit { videoTimer?.invalidate(); observers.forEach(NotificationCenter.default.removeObserver) }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        view.addSubview(arView)
        // Its frame is fitted to the camera's real portrait aspect ratio once
        // a frame arrives. The black parent supplies noninteractive letterboxes.
        arView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped(_:))))
        arView.isAccessibilityElement = true
        arView.accessibilityLabel = text("aimCorner")
        arView.accessibilityCustomActions = [UIAccessibilityCustomAction(name: text("addCorner"), target: self,
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
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled {
            makeUIPreview()
            return // No AR session, lifecycle observer, camera access or capture files.
        }
        #endif
        // Only this explicit horizontal-plane session may run; no depth or reconstruction.
        arView.session.delegateQueue = .main
        arView.session.delegate = self
        arView.scene.addAnchor(overlay)
        arView.scene.addAnchor(aimOverlay)
        makeAimGeometry()
        coaching.session = arView.session
        coaching.goal = .horizontalPlane
        coaching.activatesAutomatically = true
        let center = NotificationCenter.default
        observers = [
            center.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
                self?.pauseCaptureForBackground()
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
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled { return }
        #endif
        arView.session.run(configuration())
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if updateViewport() { updateAim() }
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled { uiPreviewGradient.frame = arView.bounds }
        #endif
    }

    @discardableResult
    private func updateViewport(imageResolution: CGSize? = nil) -> Bool {
        if let resolution = imageResolution,
           resolution.width.isFinite, resolution.height.isFinite,
           resolution.width > 0, resolution.height > 0, resolution != cameraImageResolution {
            cameraImageResolution = resolution
            viewportAvailableBounds = nil
        }
        guard let resolution = cameraImageResolution, viewportAvailableBounds != view.bounds,
              let frame = CaptureViewportMath.portraitFrame(in: view.bounds, imageResolution: resolution) else { return false }
        viewportAvailableBounds = view.bounds
        guard arView.frame != frame else { return false }
        // No constraints or setNeedsLayout on the camera view: unchanged frames
        // do no layout work, and bounds changes reuse the last valid resolution.
        arView.frame = frame
        #if DEBUG
        os_log("Full-image portrait viewport: sensor %.0fx%.0f, available %.0fx%.0f, ARView %.1fx%.1f",
               log: captureLog, type: .debug, resolution.width, resolution.height,
               view.bounds.width, view.bounds.height, frame.width, frame.height)
        #endif
        return true
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
    private func styleLabel(_ label: UILabel, size: CGFloat = 17, weight: UIFont.Weight = .regular,
                            style: UIFont.TextStyle = .body) {
        label.textColor = .white
        label.numberOfLines = 0
        label.font = UIFontMetrics(forTextStyle: style).scaledFont(for: .systemFont(ofSize: size, weight: weight))
        label.adjustsFontForContentSizeCategory = true
    }

    private func button(_ key: String, symbol: String? = nil, action: Selector? = nil,
                        diameter: CGFloat? = nil) -> UIButton {
        let button: UIButton = diameter == nil ? UIButton(type: .system) : CircularButton(type: .system)
        var config = UIButton.Configuration.plain()
        config.baseForegroundColor = .white
        config.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12)
        if let symbol = symbol {
            config.image = UIImage(systemName: symbol)
            config.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 20, weight: .semibold)
        } else { config.title = text(key) }
        button.configuration = config
        button.accessibilityLabel = text(key)
        button.titleLabel?.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 17, weight: .semibold))
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.titleLabel?.numberOfLines = 0
        button.titleLabel?.textAlignment = .center
        button.translatesAutoresizingMaskIntoConstraints = false
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        if let diameter = diameter {
            button.widthAnchor.constraint(equalToConstant: diameter).isActive = true
            button.heightAnchor.constraint(equalToConstant: diameter).isActive = true
            button.layer.cornerRadius = diameter / 2
            button.backgroundColor = UIColor(white: 1, alpha: 0.10)
        }
        if let action = action { button.addTarget(self, action: action, for: .touchUpInside) }
        return button
    }

    private func material(_ style: UIBlurEffect.Style = .systemUltraThinMaterialDark) -> UIVisualEffectView {
        let panel = UIVisualEffectView(effect: UIBlurEffect(style: style))
        panel.layer.cornerRadius = 16
        panel.clipsToBounds = true
        panel.translatesAutoresizingMaskIntoConstraints = false
        return panel
    }

    private func pin(_ child: UIView, to parent: UIView, inset: CGFloat = 0) {
        child.translatesAutoresizingMaskIntoConstraints = false
        parent.addSubview(child)
        NSLayoutConstraint.activate([
            child.leadingAnchor.constraint(equalTo: parent.leadingAnchor, constant: inset),
            child.trailingAnchor.constraint(equalTo: parent.trailingAnchor, constant: -inset),
            child.topAnchor.constraint(equalTo: parent.topAnchor, constant: inset),
            child.bottomAnchor.constraint(equalTo: parent.bottomAnchor, constant: -inset)
        ])
    }

    private func makeControls() {
        // Coaching sits behind the chrome, leaving Cancel and Skip outline reachable.
        pin(coaching, to: view)
        coaching.isUserInteractionEnabled = false
        coaching.isHidden = true
        view.bringSubviewToFront(preview)
        topChrome.axis = .vertical
        topChrome.spacing = 8
        topChrome.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(topChrome)

        let bar = material()
        let cancel = button("cancel", symbol: "xmark", action: #selector(cancelTapped), diameter: 44)
        menuButton = button("moreOptions", symbol: "ellipsis", diameter: 44)
        menuButton.showsMenuAsPrimaryAction = true
        menuButton.accessibilityIdentifier = "capture.moreOptions"
        let room = UILabel()
        styleLabel(room, size: 17, weight: .semibold, style: .headline)
        room.text = options.roomName
        room.numberOfLines = 1
        room.lineBreakMode = .byTruncatingTail
        room.textAlignment = .center
        room.accessibilityTraits = .header
        styleLabel(stepLabel, size: 12, weight: .medium, style: .caption1)
        stepLabel.numberOfLines = 1
        stepLabel.textAlignment = .center
        stepLabel.backgroundColor = UIColor(white: 1, alpha: 0.12)
        stepLabel.layer.cornerRadius = 8
        stepLabel.clipsToBounds = true
        let title = UIStackView(arrangedSubviews: [room, stepLabel])
        title.axis = .vertical
        title.spacing = 3
        title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        let heading = UIStackView(arrangedSubviews: [cancel, title, menuButton])
        heading.alignment = .center
        heading.spacing = 10
        pin(heading, to: bar.contentView, inset: 6)
        bar.heightAnchor.constraint(equalToConstant: 56).isActive = true
        topChrome.addArrangedSubview(bar)

        let instruction = material(.systemThinMaterialDark)
        let scroll = UIScrollView()
        scroll.alwaysBounceVertical = false
        pin(scroll, to: instruction.contentView)
        instructionIcon.tintColor = .white
        instructionIcon.contentMode = .scaleAspectFit
        instructionIcon.isAccessibilityElement = false
        instructionIcon.translatesAutoresizingMaskIntoConstraints = false
        instructionIcon.widthAnchor.constraint(equalToConstant: 24).isActive = true
        instructionIcon.heightAnchor.constraint(equalToConstant: 24).isActive = true
        styleLabel(statusLabel, weight: .semibold)
        styleLabel(promptLabel)
        let approximate = UILabel()
        styleLabel(approximate, size: 12, style: .caption1)
        approximate.text = text("approximateShort")
        approximate.textColor = UIColor(white: 0.90, alpha: 1)
        let instructions = UIStackView(arrangedSubviews: [statusLabel, promptLabel, approximate])
        instructions.axis = .vertical
        instructions.spacing = 3
        let instructionRow = UIStackView(arrangedSubviews: [instructionIcon, instructions])
        instructionRow.alignment = .top
        instructionRow.spacing = 10
        instructionRow.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(instructionRow)
        let naturalHeight = instruction.heightAnchor.constraint(equalTo: instructionRow.heightAnchor, constant: 20)
        naturalHeight.priority = .defaultHigh
        NSLayoutConstraint.activate([
            instructionRow.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 12),
            instructionRow.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -12),
            instructionRow.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 10),
            instructionRow.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -10),
            instructionRow.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -24),
            instruction.heightAnchor.constraint(greaterThanOrEqualToConstant: 28), naturalHeight
        ])
        topChrome.addArrangedSubview(instruction)

        reticle.image = UIImage(systemName: "scope", withConfiguration: UIImage.SymbolConfiguration(pointSize: 28, weight: .light))
        reticle.tintColor = .white
        reticle.layer.shadowColor = UIColor.black.cgColor
        reticle.layer.shadowOpacity = 0.8
        reticle.layer.shadowRadius = 2
        reticle.layer.shadowOffset = .zero
        reticle.isUserInteractionEnabled = false
        reticle.isAccessibilityElement = false
        reticle.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(reticle)

        bottomBar.layer.cornerRadius = 24
        bottomBar.clipsToBounds = true
        bottomBar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bottomBar)
        styleLabel(countLabel, size: 12, weight: .semibold, style: .caption1)
        countLabel.textAlignment = .center
        styleLabel(doorChip, size: 12, weight: .semibold, style: .caption1)
        doorChip.text = text("doorChip")
        doorChip.textAlignment = .center
        doorChip.backgroundColor = UIColor(white: 1, alpha: 0.14)
        doorChip.layer.cornerRadius = 8
        doorChip.clipsToBounds = true
        doorChip.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(doorChip)

        undoButton = button("undo", symbol: "arrow.uturn.backward", action: #selector(undoTapped), diameter: 48)
        addButton = button("addCorner", symbol: "plus", action: #selector(addTapped), diameter: 72)
        addButton.backgroundColor = .white
        addButton.configuration?.baseForegroundColor = .black
        addButton.configuration?.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 28, weight: .medium)
        addButton.accessibilityIdentifier = "capture.addCorner"
        closeButton = button("done", action: #selector(closeTapped))
        closeButton.accessibilityHint = text("closeOutline")
        layoutCameraControls(in: outlineControls, leading: undoButton, center: addButton, trailing: closeButton)
        countLabel.translatesAutoresizingMaskIntoConstraints = false
        outlineControls.addSubview(countLabel)
        NSLayoutConstraint.activate([
            countLabel.centerXAnchor.constraint(equalTo: outlineControls.centerXAnchor),
            countLabel.topAnchor.constraint(equalTo: outlineControls.topAnchor, constant: 4),
            countLabel.leadingAnchor.constraint(greaterThanOrEqualTo: outlineControls.leadingAnchor, constant: 8),
            countLabel.trailingAnchor.constraint(lessThanOrEqualTo: outlineControls.trailingAnchor, constant: -8),
            countLabel.bottomAnchor.constraint(lessThanOrEqualTo: addButton.topAnchor, constant: -3)
        ])
        shutterButton = button("shutter", action: #selector(shutterTapped), diameter: 72)
        shutterButton.backgroundColor = .clear
        shutterButton.layer.borderColor = UIColor.white.cgColor
        shutterButton.layer.borderWidth = 3
        let shutterDisc = UIView()
        shutterDisc.backgroundColor = .white
        shutterDisc.layer.cornerRadius = 29
        shutterDisc.isUserInteractionEnabled = false
        shutterDisc.isAccessibilityElement = false
        pin(shutterDisc, to: shutterButton, inset: 7)
        shutterButton.accessibilityIdentifier = "capture.shutter"
        skipButton = button("skip", action: #selector(skipTapped))
        recordVideoButton = button("recordVideo", symbol: "video", action: #selector(recordVideoTapped))
        recordVideoButton.accessibilityIdentifier = "capture.recordVideo"
        recordVideoButton.accessibilityHint = text("videoLimit")
        layoutCameraControls(in: photoControls, leading: skipButton, center: shutterButton, trailing: recordVideoButton)
        stopVideoButton = button("stopVideo", action: #selector(stopVideoTapped))
        reviewVideoButton = button("videoReview", action: #selector(reviewVideoTapped))
        retakeVideoButton = button("retakeVideo", action: #selector(retakeVideoTapped))
        useVideoButton = button("useVideo", action: #selector(useVideoTapped))
        useVideoButton.accessibilityIdentifier = "capture.useVideo"
        stopVideoButton.accessibilityIdentifier = "capture.stopVideo"
        videoSpinner.color = .white
        videoSpinner.hidesWhenStopped = true
        videoControls.addArrangedSubview(videoSpinner)
        videoControls.axis = .horizontal
        videoControls.spacing = 6
        videoControls.distribution = .fillEqually
        pin(videoControls, to: bottomBar.contentView, inset: 10)
        [stopVideoButton, reviewVideoButton, retakeVideoButton, useVideoButton].forEach(videoControls.addArrangedSubview)

        retakeButton = button("retake", action: #selector(retakeTapped))
        nextButton = button("usePhoto", action: #selector(nextTapped))
        nextButton.backgroundColor = .white
        nextButton.configuration?.baseForegroundColor = .black
        nextButton.layer.cornerRadius = 16
        reviewControls.axis = .horizontal
        reviewControls.distribution = .fillEqually
        reviewControls.spacing = 12
        pin(reviewControls, to: bottomBar.contentView, inset: 16)
        reviewControls.addArrangedSubview(retakeButton)
        reviewControls.addArrangedSubview(nextButton)

        // Combined top/bottom chrome is capped at 30% of the viewport. Long
        // prompts and larger Dynamic Type scroll inside the instruction card.
        NSLayoutConstraint.activate([
            topChrome.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            topChrome.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
            topChrome.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4),
            topChrome.heightAnchor.constraint(lessThanOrEqualTo: view.heightAnchor, multiplier: 0.30, constant: -104),
            bottomBar.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 12),
            bottomBar.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
            bottomBar.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -4),
            bottomBar.heightAnchor.constraint(equalToConstant: 104),
            reticle.centerXAnchor.constraint(equalTo: arView.centerXAnchor),
            reticle.centerYAnchor.constraint(equalTo: arView.centerYAnchor),
            reticle.widthAnchor.constraint(equalToConstant: 28), reticle.heightAnchor.constraint(equalToConstant: 28),
            doorChip.centerXAnchor.constraint(equalTo: reticle.centerXAnchor),
            doorChip.topAnchor.constraint(equalTo: reticle.bottomAnchor, constant: 12),
            doorChip.heightAnchor.constraint(greaterThanOrEqualToConstant: 24),
            doorChip.widthAnchor.constraint(greaterThanOrEqualToConstant: 64)
        ])
    }

    private func layoutCameraControls(in container: UIView, leading: UIButton, center: UIButton, trailing: UIButton? = nil) {
        pin(container, to: bottomBar.contentView)
        container.addSubview(leading)
        container.addSubview(center)
        NSLayoutConstraint.activate([
            leading.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 16),
            leading.centerYAnchor.constraint(equalTo: center.centerYAnchor),
            center.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            center.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -8),
            leading.trailingAnchor.constraint(lessThanOrEqualTo: center.leadingAnchor, constant: -8)
        ])
        if let trailing = trailing {
            container.addSubview(trailing)
            NSLayoutConstraint.activate([
                trailing.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -16),
                trailing.centerYAnchor.constraint(equalTo: center.centerYAnchor),
                trailing.leadingAnchor.constraint(greaterThanOrEqualTo: center.trailingAnchor, constant: 8)
            ])
        }
    }

    private func updateMenu() {
        let restart = UIAction(title: text("restartTracking"), image: UIImage(systemName: "arrow.clockwise"),
                               attributes: .destructive) { [weak self] _ in self?.resetTapped() }
        restart.accessibilityLabel = text("restartTracking")
        restart.accessibilityHint = text("restartConfirmMessage")
        var actions = [restart]
        if step != .photos {
            actions.append(UIAction(title: text("skipOutline"), image: UIImage(systemName: "arrow.right")) { [weak self] _ in
                self?.skipOutlineTapped()
            })
        }
        if step == .outline {
            let door = UIAction(title: text("markDoor"), image: UIImage(systemName: "door.left.hand.open"),
                                attributes: trackingNormal && !interrupted && doors.count < 8 ? [] : .disabled,
                                state: doorMode ? .on : .off) { [weak self] _ in self?.doorTapped() }
            actions.append(door)
        }
        if isVideoIdle, !saving, pendingPhoto == nil, !photos.isEmpty {
            actions.append(UIAction(title: text("done"), image: UIImage(systemName: "checkmark")) { [weak self] _ in
                self?.completeCapture()
            })
        }
        if acceptedVideo != nil {
            actions.append(UIAction(title: text("videoReview"), image: UIImage(systemName: "play.rectangle")) { [weak self] _ in
                self?.reviewVideoTapped()
            })
        }
        menuButton.menu = UIMenu(children: actions)
    }

    private func refresh() {
        guard isViewLoaded, !finished else { return }
        let isPhotos = step == .photos
        let isOutline = step == .outline
        var hasPhoto = pendingPhoto != nil
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled { hasPhoto = uiPreviewHasPhoto }
        #endif
        let progress = text("photoProgress").replacingOccurrences(of: "{current}", with: String(promptIndex + 1))
            .replacingOccurrences(of: "{total}", with: String(prompts.count))
        let status: String
        if videoState == .recording {
            status = text("videoRecording").replacingOccurrences(of: "{seconds}", with: String(min(30, Int(ProcessInfo.processInfo.systemUptime - videoStarted))))
        } else if let notice = videoNotice { status = notice }
        else if videoState == .finishing || videoState == .reviewing || videoState == .saving { status = text("videoReview") }
        else if interrupted { status = text("interrupted") }
        else if resetNotice && !trackingNormal { status = text("relocalizeFailed") }
        else if step == .floor && !relocalizing { status = text("findFloor") }
        else if !trackingNormal { status = text("trackingLimited") }
        else if isOutline {
            status = text(doorMode ? "doorMode" : corners.count >= 3 ? "moreCorners" : "aimCorner")
        } else { status = progress }
        styleLabel(statusLabel, size: isPhotos ? 13 : 17, weight: .semibold, style: isPhotos ? .caption1 : .body)
        statusLabel.text = status
        if status != lastStatus {
            lastStatus = status
            UIAccessibility.post(notification: .announcement, argument: status)
        }
        stepLabel.text = text(isPhotos ? "stepPhotos" : "stepOutline")
        instructionIcon.image = UIImage(systemName: interrupted || !trackingNormal && step != .floor ? "exclamationmark.triangle" :
                                        isPhotos ? "camera" : step == .floor ? "viewfinder" : "plus.viewfinder")
        instructionIcon.tintColor = .white
        countLabel.text = text("cornerCount").replacingOccurrences(of: "{count}", with: String(corners.count))
        promptLabel.isHidden = !isPhotos
        if isPhotos { promptLabel.text = prompts[promptIndex].text }
        outlineControls.isHidden = isPhotos
        photoControls.isHidden = !isPhotos || hasPhoto || !isVideoIdle
        reviewControls.isHidden = !isPhotos || !hasPhoto || !isVideoIdle
        videoControls.isHidden = isVideoIdle
        if videoState == .finishing || videoState == .saving { videoSpinner.startAnimating() }
        else { videoSpinner.stopAnimating() }
        videoSpinner.isHidden = videoState != .finishing && videoState != .saving
        stopVideoButton.isHidden = videoState != .recording && videoState != .finishing
        stopVideoButton.isEnabled = videoState == .recording
        reviewVideoButton.isHidden = videoState != .reviewing && videoState != .saving
        retakeVideoButton.isHidden = reviewVideoButton.isHidden
        useVideoButton.isHidden = reviewVideoButton.isHidden
        [reviewVideoButton, retakeVideoButton, useVideoButton].forEach { $0.isEnabled = videoState == .reviewing }
        recordVideoButton.isEnabled = trackingNormal && !interrupted && !saving && isVideoIdle
        recordVideoButton.alpha = recordVideoButton.isEnabled ? 1 : 0.45
        countLabel.isHidden = !isOutline
        undoButton.isEnabled = isOutline && !history.isEmpty
        closeButton.isEnabled = isOutline && !saving && corners.count >= 3 && trackingNormal && !interrupted
        addButton.isEnabled = isOutline && !saving && aimPosition != nil && trackingNormal && !interrupted &&
            (doorMode ? doors.count < 8 : corners.count < 32)
        addButton.alpha = addButton.isEnabled ? 1 : 0.45
        addButton.accessibilityLabel = text(doorMode ? "markDoor" : "addCorner")
        shutterButton.isEnabled = trackingNormal && !interrupted && !saving && isVideoIdle
        shutterButton.alpha = shutterButton.isEnabled ? 1 : 0.45
        retakeButton.isEnabled = !saving && isVideoIdle
        skipButton.isEnabled = !saving && isVideoIdle
        nextButton.isEnabled = !saving && isVideoIdle && hasPhoto
        let nextKey = promptIndex == prompts.count - 1 ? "done" : "usePhoto"
        nextButton.configuration?.title = text(nextKey)
        nextButton.accessibilityLabel = text(nextKey)
        arView.isAccessibilityElement = !isPhotos
        arView.accessibilityElementsHidden = hasPhoto
        preview.isHidden = !hasPhoto
        doorChip.isHidden = !isOutline || !doorMode
        reticle.isHidden = !isOutline || !trackingNormal || interrupted
        aimOverlay.isEnabled = isOutline && trackingNormal && !interrupted && aimPosition != nil
        reticle.tintColor = .white
        reticle.image = UIImage(systemName: "scope")
        reticle.alpha = aimPosition == nil ? 0.45 : 1
        coaching.isHidden = step != .floor || hasPhoto || interrupted
        if coaching.isHidden { coaching.setActive(false, animated: false) }
        updateMenu()
    }

    @objc private func tapped(_ gesture: UITapGestureRecognizer) { place(at: gesture.location(in: arView)) }
    @objc private func placeAtCenter() -> Bool {
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled { advanceUIPreview(); return true }
        #endif
        updateAim()
        place(at: CGPoint(x: arView.bounds.midX, y: arView.bounds.midY))
        return true
    }
    @objc private func addTapped() { _ = placeAtCenter() }
    private func place(at point: CGPoint) {
        guard step == .outline, trackingNormal, !interrupted, let floor = floorY, !finished, !saving,
              point.x.isFinite, point.y.isFinite, arView.bounds.contains(point),
              let ray = arView.ray(through: point),
              let position = CaptureFloorMath.intersection(origin: ray.origin, direction: ray.direction, floorY: floor) else { return }
        if doorMode {
            guard doors.count < 8 else { return }
            doors.append(position)
            history.append(.door)
            doorMode = false
        } else {
            guard corners.count < 32,
                  corners.last.map({ simd_distance($0, position) > 0.03 }) ?? true,
                  corners.first.map({ corners.count < 2 || simd_distance($0, position) > 0.03 }) ?? true else { return }
            corners.append(position)
            history.append(.corner)
        }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        drawOutline()
        updateAim()
        refresh()
        UIAccessibility.post(notification: .announcement, argument: countLabel.text)
    }

    private func makeAimGeometry() {
        // A reusable flat ring: no mesh allocation on frame callbacks.
        let radius: Float = 0.085
        let pieces = 32
        for index in 0..<pieces {
            let angle = Float(index) * 2 * .pi / Float(pieces)
            let segment = ModelEntity(mesh: .generateBox(size: SIMD3(0.012, 0.004, 2 * .pi * radius / Float(pieces))),
                                      materials: [UnlitMaterial(color: .white)])
            segment.position = SIMD3(cos(angle) * radius, 0, sin(angle) * radius)
            segment.orientation = simd_quatf(angle: -angle, axis: SIMD3(0, 1, 0))
            aimRing.addChild(segment)
        }
        aimOverlay.addChild(aimRing)
        aimOverlay.addChild(aimLine)
        aimOverlay.isEnabled = false
    }

    private func updateAim() {
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled {
            refresh()
            return
        }
        #endif
        let oldHasAim = aimPosition != nil
        aimPosition = nil
        if step == .outline, trackingNormal, !interrupted, !finished, !saving, let floor = floorY,
           let ray = arView.ray(through: CGPoint(x: arView.bounds.midX, y: arView.bounds.midY)),
           let position = CaptureFloorMath.intersection(origin: ray.origin, direction: ray.direction, floorY: floor) {
            // Raycast against the SAME saved plane as taps, even if ARKit has
            // removed its anchors. It must not jump to a newly estimated plane.
            aimPosition = position
            if let target = aimPosition {
                aimRing.position = SIMD3(target.x, floor + 0.012, target.y)
                aimLine.isEnabled = !doorMode && !corners.isEmpty
                if let last = corners.last, !doorMode {
                    let start = SIMD3(last.x, floor + 0.015, last.y)
                    let end = SIMD3(target.x, floor + 0.015, target.y)
                    let length = simd_distance(start, end)
                    aimLine.isEnabled = length > 0.001
                    if length > 0.001 {
                        aimLine.position = (start + end) / 2
                        aimLine.scale = SIMD3(1, 1, length)
                        aimLine.orientation = simd_quatf(from: SIMD3(0, 0, 1), to: simd_normalize(end - start))
                    }
                }
            }
        }
        aimOverlay.isEnabled = aimPosition != nil
        if oldHasAim != (aimPosition != nil) { refresh() }
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
        guard step == .outline, !finished, !saving, let mark = history.popLast() else { return }
        switch mark { case .corner: corners.removeLast(); case .door: doors.removeLast() }
        closed = false
        drawOutline()
        updateAim()
        refresh()
    }
    @objc private func doorTapped() {
        guard step == .outline, !finished, !saving, trackingNormal, !interrupted else { return }
        doorMode.toggle(); updateAim(); refresh()
    }
    @objc private func closeTapped() {
        guard step == .outline, !finished, !saving, corners.count >= 3, trackingNormal, !interrupted else { return }
        closed = true
        UINotificationFeedbackGenerator().notificationOccurred(.success)
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
        aimOverlay.isEnabled = false
        aimPosition = nil
        refresh()
        UIAccessibility.post(notification: .screenChanged, argument: promptLabel)
    }

    private func pauseCaptureForBackground() {
        guard !finished else { return }
        discardActiveVideo(showInterrupted: true)
        interrupted = true
        trackingNormal = false
        arView.session.pause()
        refresh()
    }

    private var isVideoIdle: Bool { videoState == .idle && !videoCommitPending }

    @objc private func recordVideoTapped() {
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled { setUIPreviewState(5); return }
        #endif
        guard !finished, step == .photos, isVideoIdle, !saving, pendingPhoto == nil,
              trackingNormal, !interrupted else { return }
        let id = UUID()
        videoGeneration = id
        candidateVideo = nil
        videoNotice = nil
        videoState = .recording
        videoStarted = ProcessInfo.processInfo.systemUptime
        videoWriter.start(generation: id, takenAt: CaptureFiles.timestamp())
        videoTimer?.invalidate()
        videoTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.refresh() }
        refresh()
    }
    @objc private func stopVideoTapped() {
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled { setUIPreviewState(6); return }
        #endif
        guard videoState == .recording, let id = videoGeneration else { return }
        videoState = .finishing
        videoTimer?.invalidate()
        videoWriter.stop(generation: id)
        refresh()
    }
    @objc private func reviewVideoTapped() {
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled { return } // Layout only: no file/player/camera assets.
        #endif
        guard !finished, presentedViewController == nil, let clip = candidateVideo ?? acceptedVideo else { return }
        let player = AVPlayerViewController()
        player.player = AVPlayer(url: clip.url)
        present(player, animated: true) // System controls; no automatic playback.
    }
    @objc private func retakeVideoTapped() {
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled { setUIPreviewState(5); return }
        #endif
        guard videoState == .reviewing else { return }
        discardActiveVideo(showInterrupted: false)
        recordVideoTapped()
    }
    @objc private func useVideoTapped() {
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled { setUIPreviewState(3); return }
        #endif
        guard !finished, videoState == .reviewing, let id = videoGeneration else { return }
        videoState = .saving
        videoCommitPending = true
        refresh()
        videoWriter.use(generation: id) { [weak self] result in
            guard let self = self, !self.finished else { return }
            let stillCurrent = self.videoGeneration == id
            self.videoCommitPending = false
            switch result {
            case .success(let video):
                self.acceptedVideo = video
                self.candidateVideo = nil
                self.videoGeneration = nil
                self.videoState = .idle
                self.videoNotice = self.text(stillCurrent ? "videoSaved" : "videoStopped")
            case .failure:
                self.videoState = stillCurrent ? .reviewing : .idle
                if stillCurrent { self.videoNotice = self.text("videoFailed") }
            }
            self.refresh()
        }
    }
    private func discardActiveVideo(showInterrupted: Bool) {
        videoTimer?.invalidate()
        videoTimer = nil
        let hadCandidate = videoGeneration != nil
        if hadCandidate { videoWriter.discard() }
        videoGeneration = nil
        candidateVideo = nil
        // A committed replacement may be awaiting its main-thread callback. Wait for its
        // result before allowing Done, so the sidecar can never describe the old bytes.
        videoState = videoCommitPending ? .saving : .idle
        if hadCandidate && showInterrupted { videoNotice = text("videoStopped") }
    }

    @objc private func shutterTapped() {
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled { setUIPreviewState(4, prompt: promptIndex); return }
        #endif
        guard step == .photos, trackingNormal, !interrupted, !saving, isVideoIdle, pendingPhoto == nil, !finished,
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
    @objc private func retakeTapped() {
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled { setUIPreviewState(3, prompt: promptIndex); return }
        #endif
        guard !saving, isVideoIdle else { return }; removePendingPhoto(); refresh()
    }
    @objc private func skipTapped() {
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled { advanceUIPreviewPhoto(); return }
        #endif
        guard !saving, isVideoIdle, !finished else { return }
        // Skipping the final prompt with no retained photos closes as a benign
        // cancellation. Never emit an empty/invalid completed manifest.
        if promptIndex == prompts.count - 1 && photos.isEmpty {
            if acceptedVideo != nil {
                videoNotice = text("videoNeedsPhoto")
                refresh()
                return
            }
            removePendingPhoto()
            abort()
            return
        }
        removePendingPhoto()
        advance()
    }
    @objc private func nextTapped() {
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled { advanceUIPreviewPhoto(); return }
        #endif
        guard !saving, isVideoIdle, !finished else { return }
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
        guard !finished, !saving, isVideoIdle, pendingPhoto == nil, !photos.isEmpty, photos.count <= 40 else { return }
        let outline: Any = corners.count >= 3 ? ["closed": closed, "points": corners.map { [Double($0.x), Double($0.y)] }] : NSNull()
        var result: [String: Any] = [
            "format": "fixlist-room-capture", "version": 1, "captureId": options.captureId,
            "roomId": options.roomId, "createdAt": createdAt, "mode": "arkit",
            "floorY": floorY.map { Double($0) } as Any? ?? NSNull(), "outline": outline,
            "doors": doors.map { [Double($0.x), Double($0.y)] }, "photos": photos.map(\.json),
            "files": Dictionary(uniqueKeysWithValues: photos.map { ($0.photoId, $0.url.absoluteString) })
        ]
        if let video = acceptedVideo {
            result["videos"] = ["format": "fixlist-capture-videos", "version": 1,
                                "captureId": options.captureId, "roomId": options.roomId, "clips": [video.json]]
            var files = Dictionary(uniqueKeysWithValues: photos.map { ($0.photoId, $0.url.absoluteString) })
            files["v01"] = video.url.absoluteString
            result["files"] = files
        }
        finish(["status": "completed", "capture": result], keepFiles: true)
    }

    @objc private func cancelTapped() {
        guard !finished else { return }
        guard !photos.isEmpty || pendingPhoto != nil || saving || acceptedVideo != nil || !isVideoIdle else { abort(); return }
        let alert = UIAlertController(title: text("cancelConfirmTitle"), message: text("videoCancel"), preferredStyle: .alert)
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
        // This must precede UIKit dismissal and the plugin's synchronous discard enqueue.
        discardActiveVideo(showInterrupted: false)
        aimOverlay.isEnabled = false
        coaching.setActive(false, animated: false)
        arView.session.pause()
        arView.session.delegate = nil
        observers.forEach(NotificationCenter.default.removeObserver)
        observers.removeAll()
        let closed = {
            #if DEBUG && targetEnvironment(simulator)
            if CaptureUIPreview.enabled {
                // Synthetic layout review cannot return or remove capture files.
                self.completion(["status": "cancelled"])
                return
            }
            #endif
            if keepFiles { self.completion(outcome) }
            else {
                CaptureFiles.queue.async {
                    var result = outcome
                    do { try CaptureFiles.remove(CaptureFiles.folder(self.options.captureId)) }
                    catch {
                        result["cleanupFailed"] = true
                        os_log("FixListCapture cancelled cache cleanup failed", log: captureLog, type: .error)
                    }
                    let delivered = result
                    DispatchQueue.main.async { self.completion(delivered) }
                }
            }
        }
        // Dismiss a cancellation alert first if reset/discard arrives while it is
        // open, then the entire capture. The promise is resolved exactly once.
        if presentedViewController != nil {
            dismiss(animated: false) { self.dismiss(animated: true, completion: closed) }
        } else { dismiss(animated: true, completion: closed) }
    }

    @objc private func resetTapped() {
        guard !finished, presentedViewController == nil else { return }
        guard !corners.isEmpty || !doors.isEmpty || !photos.isEmpty || pendingPhoto != nil || saving else {
            resetWorld()
            return
        }
        let alert = UIAlertController(title: text("restartConfirmTitle"), message: text("restartConfirmMessage"), preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: text("cancelConfirmKeep"), style: .cancel))
        alert.addAction(UIAlertAction(title: text("restartTracking"), style: .destructive) { [weak self] _ in
            self?.resetWorld()
        })
        present(alert, animated: true)
    }
    private func resetWorld() {
        #if DEBUG && targetEnvironment(simulator)
        if CaptureUIPreview.enabled { setUIPreviewState(0); return }
        #endif
        guard !finished else { return }
        discardActiveVideo(showInterrupted: true)
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
        discardActiveVideo(showInterrupted: true)
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
        updateViewport(imageResolution: frame.camera.imageResolution)
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
            // A plane may have been added while tracking was limited. Recheck
            // only after the current world frame is usable again.
            if normal { updatePlanes(frame.anchors) }
        }
        if normal, !interrupted, videoState == .recording, let generation = videoGeneration {
            let buffer = frame.capturedImage
            let timestamp = frame.timestamp
            videoWriter.submit(generation: generation, buffer: buffer, timestamp: timestamp)
        }
        updateAim()
    }
    func session(_ session: ARSession, didAdd anchors: [ARAnchor]) { updatePlanes(anchors) }
    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) { updatePlanes(anchors) }
    func session(_ session: ARSession, didRemove anchors: [ARAnchor]) {
        for anchor in anchors { planeHeights.removeValue(forKey: anchor.identifier) }
        updatePlanes([])
    }
    private func updatePlanes(_ anchors: [ARAnchor]) {
        guard !finished, trackingNormal, !interrupted,
              let cameraY = arView.session.currentFrame?.camera.transform[3].y else { return }
        for case let plane as ARPlaneAnchor in anchors where plane.alignment == .horizontal {
            let y = (plane.transform * SIMD4(plane.center.x, plane.center.y, plane.center.z, 1)).y
            planeHeights[plane.identifier] = CaptureFloorMath.candidate(height: y, cameraY: cameraY,
                classification: plane.classification)
        }
        let locked = step == .photos || !corners.isEmpty || !doors.isEmpty || !photos.isEmpty || pendingPhoto != nil || saving
        guard let lowest = CaptureFloorMath.select(previous: floorY, heights: Array(planeHeights.values), locked: locked) else {
            if !locked {
                floorY = nil
                if step == .outline { step = .floor }
                drawOutline()
                refresh()
            }
            return
        }
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
        } else {
            discardActiveVideo(showInterrupted: true)
            trackingNormal = false
            interrupted = true
            // Saved photos remain finishable through Done even if tracking cannot recover.
            beginPhotos()
        }
    }

    #if DEBUG && targetEnvironment(simulator)
    private func makeUIPreview() {
        // This preview generates a 600x800 portrait image; it has no ARCamera.
        updateViewport(imageResolution: CGSize(width: 800, height: 600))
        uiPreviewGradient.colors = [UIColor(white: 0.24, alpha: 1).cgColor, UIColor(white: 0.08, alpha: 1).cgColor]
        uiPreviewGradient.startPoint = CGPoint(x: 0, y: 0)
        uiPreviewGradient.endPoint = CGPoint(x: 1, y: 1)
        arView.layer.addSublayer(uiPreviewGradient)
        let nextState = button("previewNextState", action: #selector(advanceUIPreview))
        nextState.backgroundColor = UIColor(white: 0, alpha: 0.7)
        nextState.layer.cornerRadius = 12
        nextState.accessibilityIdentifier = "capture.preview.nextState"
        view.addSubview(nextState)
        NSLayoutConstraint.activate([
            nextState.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            nextState.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: 84)
        ])
        setUIPreviewState(CaptureUIPreview.initialState)
    }

    @objc private func advanceUIPreview() { setUIPreviewState((uiPreviewState + 1) % 7) }

    private func advanceUIPreviewPhoto() {
        if promptIndex + 1 < prompts.count { setUIPreviewState(3, prompt: promptIndex + 1) }
        else { setUIPreviewState(0) } // No synthetic completed capture leaves the preview.
    }

    private func setUIPreviewState(_ state: Int, prompt: Int? = nil) {
        uiPreviewState = state
        videoState = state == 5 ? .recording : state == 6 ? .reviewing : .idle
        videoStarted = ProcessInfo.processInfo.systemUptime - 7
        videoNotice = nil
        uiPreviewHasPhoto = state == 4
        step = state == 0 ? .floor : state < 3 ? .outline : .photos
        trackingNormal = state != 0
        interrupted = false
        resetNotice = false
        floorY = state == 0 ? nil : -1.2
        corners = state == 2 ? [SIMD2(0, 0), SIMD2(2, 0), SIMD2(2, 2), SIMD2(0, 2)] : []
        history = corners.map { _ in .corner }
        doors.removeAll()
        closed = false
        doorMode = false
        aimPosition = step == .outline ? SIMD2(0, 0) : nil
        promptIndex = state >= 3 ? min(prompt ?? 1, prompts.count - 1) : 0
        if uiPreviewHasPhoto {
            preview.image = UIGraphicsImageRenderer(size: CGSize(width: 600, height: 800)).image { context in
                UIColor(white: 0.27, alpha: 1).setFill()
                context.fill(CGRect(x: 0, y: 0, width: 600, height: 800))
            }
            preview.accessibilityLabel = prompts[promptIndex].text
        } else { preview.image = nil }
        refresh()
        // ARCoachingOverlayView requires a real session: the finding-floor card
        // is the Simulator representation, with no fake tracking claim.
        coaching.isHidden = true
    }
    #endif
}

/// Keeps fixed-diameter capture controls circular; UIButton configuration updates can reset layer corners.
private final class CircularButton: UIButton {
    override func layoutSubviews() {
        super.layoutSubviews()
        layer.cornerCurve = .circular
        layer.cornerRadius = min(bounds.width, bounds.height) / 2
    }
}
