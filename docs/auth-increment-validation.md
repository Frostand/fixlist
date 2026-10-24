# Auth foundation and native integration — local evidence

Foundation: 2b67d66 (base d7ba0495235506e8be1eeffb6d854ea395d01b37). Native integration: parent a2426c9. No push/cloud project/provider configuration/migration application performed. No other agents used. The user selected a new Supabase setup; project creation is waiting for dashboard login, and paid spending is not authorized.

## Foundation checks (recorded at 2b67d66)

- `npm test`: **89 files, 2,073 passed, 1 skipped**. The skip is the existing opt-in real iOS model validation (`FIXLIST_REQUIRE_IOS_MODEL=1`), unrelated to auth; no model was downloaded.
- 40 new auth/UI tests cover email registration/confirmation/resend/login/reset, official Supabase SDK requests with mocked transport, PKCE persistence, web/native callback allowlists, expiry/cancel/replay, duplicate failed-exchange visibility, StrictMode cleanup/restart, native Apple raw-nonce exchange payload, backend identity mismatches, both role setup inserts/reloads, unavailable states, profile outages, project/UID separation, immediate ownership invalidation, stale reads/writes, repeated sign-out, queued native prompt cancellation, Keychain failure propagation, and actual auth form/provider/setup handlers.
- A duplicate failed exchange regression was run red: the second callback incorrectly resolved `ignored`; after outcome caching it rejects without a second exchange. A queued-native cancellation test also ran red (a cancelled prompt still opened) and now passes with generation checks at enqueue time. Added web startup tests show stripped callbacks survive StrictMode cleanup until active processing finishes.
- `npm run typecheck`: passed.
- `npm run build`: passed. Existing large-chunk warning remains in the lazy 3D viewer path; no performance improvement is claimed. Supabase/auth UI is lazy-loaded.
- `npm audit --omit=dev`: zero production vulnerabilities reported.
- `git diff --check`: passed before commit.
- New Swift plugin source: `xcrun swiftc -typecheck` passed against official Capacitor/Cordova 8.5.3 xcframeworks for both `arm64-apple-ios15.0-simulator` (iPhoneSimulator26.5 SDK) and `arm64-apple-ios15.0` (iPhoneOS26.5 SDK). This is source typechecking, not an integrated/signed app build.
- T3 collaborative browser on local Vite, 320×844 CSS pixels: unconfigured real auth shown with disabled providers; no initial seeded community store; explicit demo banner; filled Margaret and blank elder/volunteer choices present; selecting blank elder showed empty required name/area inputs; returning to real auth removed the demo tree; no horizontal overflow or Vite error overlay in checked states. Browser checks used no backend credentials or external auth.

## Native integration checks (executed 2026-10-24)

- `npm ci` with Node 24.18.0/npm 11.16.0, then `npm run ios:sync`: passed, including the source model identity gate, TypeScript/production web build and Capacitor sync. Existing lazy 3D-viewer chunk warning remains.
- `npm test -- src/auth src/app/community/auth-ui.test.tsx scripts/verify-ios-model.test.mjs`: **7 files passed, 49 tests passed, 1 skipped** (the existing opt-in real-model test). Full-suite counts above belong to the foundation; the parent will run its acceptance suite.
- Both integrated unsigned builds passed using `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug CODE_SIGNING_ALLOWED=NO build`, with `-destination 'generic/platform=iOS Simulator' -derivedDataPath ios/DerivedData/native-auth-simulator` and `-destination 'generic/platform=iOS' -derivedDataPath ios/DerivedData/native-auth-device`. The auth plugin compiled for Simulator arm64/x86_64 and device arm64. Source and bundled model verification phases ran without bypasses. Xcode emitted only the AppIntents metadata extraction warning (no AppIntents dependency).
- `plutil -lint` passed for the project, Info.plist and App.entitlements. Parsed project checks confirmed exactly one auth source file/build/group/Sources entry, preserved CaptureVideoWriter registration, and `CODE_SIGN_ENTITLEMENTS = App/App.entitlements` for both Debug and Release. The source entitlement is `com.apple.developer.applesignin = ["Default"]`. Both merged app plists contain the exact callback URL type/name/scheme and updated camera/photo copy; bundle ID `app.fixlist.demo` and minimum iOS 15.0 remain unchanged.
- Source comparison against a2426c9 confirmed unchanged capture/Assistant implementations, both model verification phases and existing cold/warm/universal-link scene forwarding. All three provider flags remain false in `.env.example`. Source inspection confirms SecItem get/update/add/delete with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, no executable UserDefaults use, cryptographic nonce/state generation, SHA-256 nonce sent to Apple, returned-state comparison and nonce/state clearing. Existing mocked tests cover native storage failure propagation and raw-nonce exchange; these do not establish provider behavior.
- On an isolated iPhone 17/iOS 26.5 Simulator, the integrated unsigned app reported `Capacitor.isPluginAvailable('FixListAuth') === true` and platform `ios`. LLDB inspected the existing WebView and invoked the existing Capacitor methods with only `PUBLIC_SYNTHETIC_NATIVE_AUTH_20261024` at a synthetic `fixlist:live:` key; no production probe source or provider request was added. `storageGet`, `storageSet` and `storageRemove` each rejected with `Secure storage unavailable`; localStorage contained no synthetic key. **Successful Keychain storage roundtrip remains UNVERIFIED**; plugin availability is the runtime result established here. Public-only result: `/tmp/fixlist-native-auth-runtime.json`.
- Local build logs: `/tmp/fixlist-native-auth-ios-sync.log`, `/tmp/fixlist-native-auth-simulator-build.log`, `/tmp/fixlist-native-auth-device-build.log`; focused test log: `/tmp/fixlist-native-auth-tests.log`.

## Not executed / not qualified

- Supabase CLI absent; Docker daemon unavailable. Prepared 18 pgTAP checks are **UNEXECUTED**. Migration remains **UNAPPLIED**. SQL/RLS correctness needs execution on a disposable local stack before hosted application.
- Email delivery/confirmation/recovery, Google/Apple OAuth, Apple native nonce validation against a real provider, token refresh/Keychain lock/reinstall behavior and warm/cold signed-iPhone callbacks are **UNVERIFIED** without owner configuration/test accounts/signed device. Mock success and unsigned builds do not establish live auth.
- Plugin target/bridge registration, callback URL scheme and local Apple entitlement settings are integrated. The actual registered App ID's Apple capability, matching provisioning profile and Supabase/provider audiences remain **UNVERIFIED**. Default provider flags remain false.
- Real jobs/messages/hours/family/screening/captures remain unavailable. Profile edit/delete and full auth translations are follow-ups. Setup stores preferences only; role grants no community authority.

## Integration scope

The foundation changed package.json/lockfile (one pinned official dependency), CommunityApp wrapper/remount key, two outdated Root expectations, and index metadata; its other source files were new. Auth copy uses isolated `src/i18n/auth.ts` with an explicit English fallback.

This native integration changes only the Xcode project, SceneDelegate registration, Info.plist, new App.entitlements, a mechanical plugin registration comment, this validation document, the setup guide and README. No auth JavaScript/gateway/UI or capture/Assistant implementation changed. Owner work from the main checkout was not copied into this isolated worktree.

Exact setup, callback glob patterns, provider dashboard requirements, native registration instructions and transactional-community follow-up gates: `docs/supabase-auth-setup.md`.
