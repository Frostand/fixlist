# Native capture M1

`FixListCapturePlugin.swift` registers the five promise methods. `FixListCaptureViewController.swift` owns one portrait ARKit session and RealityKit markers. No package, entitlement, microphone/location use, depth input, reconstruction API or network operation was added. Only horizontal plane detection and gravity alignment are configured. Unsupported ARKit resolves `unavailable`; the web owns the photo-only fallback.

## Coordinates and JPEGs

`CapturePortraitMath.make` is a pure function. For a clockwise portrait rotation, sensor edge coordinates map `(u,v)` to `(H-v,u)`. Upright +X is sensor +Y, upright +Y is sensor -X, and -Z is unchanged, so the camera-to-world matrix is post-multiplied by a +90-degree Z rotation. Focal lengths swap. The SDK's `ARCamera.h` documents intrinsics relative to the upper-left pixel's centre; 0.5 is added before conversion to the contract's edge-origin coordinates. Each axis is scaled by the actual rounded output dimension. Translation stays unchanged. Output matrices are checked for finite values, orthonormality and determinant +1.

Pixels use Core Image `.right`, followed by resizing without cropping. ImageIO receives a fresh CGImage and only JPEG quality 0.85, with empty destination properties. The encoded bytes are checked for absent EXIF, EXIF auxiliary, GPS and TIFF dictionaries before writing. SHA-256 covers those exact bytes. The cache folder and JPEG use complete file protection. Captures are outside the app's public directory and never uploaded.

The DEBUG on-frame check projects the point 1 metre straight ahead and an off-axis point through `ARCamera.projectPoint` with `.portrait` and the stored dimensions. `projectPoint` aspect-fills a viewport; the stored JPEG preserves the full sensor. The check undoes the small crop introduced by integer dimension rounding before comparison. The SDK/contract pixel-origin difference is below one pixel. Disagreement greater than 2 pixels is logged and the photo fails, rather than silently accepting an inconsistent pose. This on-frame check requires a real phone.

The DEBUG load-time synthetic test covers off-centre intrinsics, translation, off-axis projection, resize including odd dimensions, upright axes, and invalid input. It requires no AR session. Simulator Debug builds additionally accept the launch argument `--fixlist-capture-smoke-test`: it evaluates the actual `Capacitor.Plugins.FixListCapture` JavaScript methods and opens a share sheet containing synthetic text. Dismiss that sheet without sending it. This opt-in probe is excluded from device and Release builds.

## Lifecycle and contract clarifications

- **Superseded by overnight integration:** the original worker accepted optional `roomId` and emitted an empty value when absent. The integrated contract now requires and echoes the catalog room ID; overview prompts accept explicit `checklistItemId: null`. The realistic Simulator bridge probe verifies both, and rejects missing/numeric/empty prompt IDs. See `capture-integration-notes.md` and the overnight acceptance record.
- Zero prompts are accepted. Because a completed manifest requires 1–40 photos, zero prompts offer one extra photo with `checklistItemId: null`, labelled with the supplied room name. Skipping every prompt closes with `cancelled` and deletes the empty capture. No empty completed manifest is emitted.
- Missing/empty native string keys fall back individually to English. Input sizes are bounded; invalid options resolve `failed` with a short machine-readable reason. Reusing an existing native capture ID fails rather than overwriting its files. Completion resolves only after dismissal.
- Limited/interrupted tracking disables corner taps and shutter. Backgrounding pauses; foregrounding runs the configuration without reset and attempts relocalization indefinitely. While relocalizing, the existing `skipOutline` control explicitly abandons recovery. This reuses the existing string keys because the contract has no restart-action string. The outline/doors are cleared, all old photo cameras become null, and `relocalizeFailed` is announced and remains visible. A first `worldTrackingFailed` also takes this explicit reset path; a subsequent session failure resolves `failed`.
- One serial queue orders native writes and deletes. Cancellation/reset invalidates the controller before cleanup is queued, preventing a late JPEG write from resurrecting a deleted capture. In-flight photos from a previous world generation also lose their camera pose. Discard methods are idempotent. Cancelled/failed sessions remove their native folder.
- Sharing accepts UTF-8 text up to the contract's 48 MiB export cap. `.` and `..` are rejected in addition to the specified filename character check, since they name directories. A random temporary directory avoids collisions; it is removed after sheet completion. No share destination is selected automatically.
- Native labels/buttons use supplied strings, Dynamic Type, scrolling high-contrast panels and >=44-point controls. The floor view exposes a VoiceOver action to place a point at its centre. Full VoiceOver, large-text usability, portrait presentation, plane selection, raycasts, JPEG orientation and session recovery remain phone acceptance checks.

## Verification

Run from this worktree with Node 24.18.0, npm 11.16.0 and Xcode 26.6 (17F113):

```sh
npm ci
npm run build && npx cap sync ios
npm run typecheck && npm test
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'platform=iOS Simulator,id=133B41A2-044F-479A-AFC6-B6E3865F056C' -derivedDataPath "$PWD/ios/DerivedData" build
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'generic/platform=iOS' -derivedDataPath "$PWD/ios/DerivedData" CODE_SIGNING_ALLOWED=NO build
xcrun simctl install 133B41A2-044F-479A-AFC6-B6E3865F056C "$PWD/ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app"
xcrun simctl launch 133B41A2-044F-479A-AFC6-B6E3865F056C app.fixlist.demo --fixlist-capture-smoke-test
git diff --check
```

- Install, web build, Capacitor sync, typecheck and whitespace checks passed. Vitest: **47 files, 1395 tests passed**. No TypeScript files changed. The initial JS chunk is 171.48 KiB gzip; Vite still warns about the existing lazy scan-viewer chunk.
- Both final xcodebuild commands ended with the exact line `** BUILD SUCCEEDED **`. Neither emitted warnings from the new Swift files. Each emitted Xcode's `Metadata extraction skipped. No AppIntents.framework dependency found.` warning. The first compilation caught an ambiguous `Double.init` in `floorY` conversion; an explicit closure fixed it. Initial remote package refresh timed out, then Xcode recovered and resolved the pinned Capacitor 8.5.3 package.
- The requested Simulator was opened in T3's Device panel. Installation through the returned `agent-device` launcher succeeded. Its `open` command returned `DEVICE_IN_USE` for an older session; launch then used `simctl`, and share-sheet inspection/dismissal used the native Simulator window titled `iPhone 17 Pro`. The other booted device, `FixList UI iPhone 17 Pro`, was not used for verification.
- The opt-in probe ran actual `Capacitor.Plugins.FixListCapture` JavaScript calls. It logged `availability: {camera: "not-determined", arkit: false}`, `start: {status: "unavailable"}` and successful repeated `discard`. The system share sheet visibly displayed `fixlist-native-smoke` (43 bytes). Dismissal without sending logged `FixListCapture JS share probe: success({"completed":false})`. Subsequent filesystem inspection found no synthetic share file and no synthetic capture folder.
- Exact DEBUG math log: `FixListCapture portrait math self-test: PASS (9 projections, resize, axes, invalid input)`.
- Logs were captured in `/tmp/fixlist-native-simulator-build.log`, `/tmp/fixlist-native-device-build.log`, and `/tmp/fixlist-native-simulator-runtime.log` (local ephemeral evidence).

Simulator ARKit is unavailable; no Simulator result establishes that the AR flow works on an iPhone. The installed runtime is iOS 26.5, not the requested target iOS 27. A generic unsigned device build only proves compilation. All real-phone capture, permission, image/pose, recovery, accessibility, signing, export and import acceptance remains outstanding.

Implementation assistance: Codex `gpt-6.1-sol` with xhigh reasoning in T3 Code. No student contribution, physical validation or final reviewer acceptance is asserted here.
