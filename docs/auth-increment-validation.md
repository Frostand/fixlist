# Auth increment 1 — local implementation evidence

Base: d7ba0495235506e8be1eeffb6d854ea395d01b37. No push/cloud project/provider configuration/migration application performed. No other agents used.

## Executed

- `npm test`: **89 files, 2,073 passed, 1 skipped**. The skip is the existing opt-in real iOS model validation (`FIXLIST_REQUIRE_IOS_MODEL=1`), unrelated to auth; no model was downloaded.
- 40 new auth/UI tests cover email registration/confirmation/resend/login/reset, official Supabase SDK requests with mocked transport, PKCE persistence, web/native callback allowlists, expiry/cancel/replay, duplicate failed-exchange visibility, StrictMode cleanup/restart, native Apple raw-nonce exchange payload, backend identity mismatches, both role setup inserts/reloads, unavailable states, profile outages, project/UID separation, immediate ownership invalidation, stale reads/writes, repeated sign-out, queued native prompt cancellation, Keychain failure propagation, and actual auth form/provider/setup handlers.
- A duplicate failed exchange regression was run red: the second callback incorrectly resolved `ignored`; after outcome caching it rejects without a second exchange. A queued-native cancellation test also ran red (a cancelled prompt still opened) and now passes with generation checks at enqueue time. Added web startup tests show stripped callbacks survive StrictMode cleanup until active processing finishes.
- `npm run typecheck`: passed.
- `npm run build`: passed. Existing large-chunk warning remains in the lazy 3D viewer path; no performance improvement is claimed. Supabase/auth UI is lazy-loaded.
- `npm audit --omit=dev`: zero production vulnerabilities reported.
- `git diff --check`: passed before commit.
- New Swift plugin source: `xcrun swiftc -typecheck` passed against official Capacitor/Cordova 8.5.3 xcframeworks for both `arm64-apple-ios15.0-simulator` (iPhoneSimulator26.5 SDK) and `arm64-apple-ios15.0` (iPhoneOS26.5 SDK). This is source typechecking, not an integrated/signed app build.
- T3 collaborative browser on local Vite, 320×844 CSS pixels: unconfigured real auth shown with disabled providers; no initial seeded community store; explicit demo banner; filled Margaret and blank elder/volunteer choices present; selecting blank elder showed empty required name/area inputs; returning to real auth removed the demo tree; no horizontal overflow or Vite error overlay in checked states. Browser checks used no backend credentials or external auth.

## Not executed / not qualified

- Supabase CLI absent; Docker daemon unavailable. Prepared 18 pgTAP checks are **UNEXECUTED**. Migration remains **UNAPPLIED**. SQL/RLS correctness needs execution on a disposable local stack before hosted application.
- Email delivery/confirmation/recovery, Google/Apple OAuth, Apple native nonce validation against a real provider, token refresh/Keychain behavior and warm/cold signed-iPhone callbacks are **UNVERIFIED** without owner configuration/test accounts/signed device. Mock success and source typechecking do not establish live auth.
- New plugin target registration, URL scheme, Apple entitlement and provider audiences remain parent-owned integration steps. The current native build intentionally reports auth unavailable until registration exists.
- Real jobs/messages/hours/family/screening/captures remain unavailable. Profile edit/delete and full auth translations are follow-ups. Setup stores preferences only; role grants no community authority.

## Integration scope

Changed existing files: package.json/lockfile (one pinned official dependency), CommunityApp wrapper/remount key, two outdated Root expectations, and index metadata. All other source files are new. Auth copy uses isolated `src/i18n/auth.ts` with an explicit English fallback. No shared nine-language dictionary, Elder.tsx, Volunteer.tsx, task-rules, capture/Assistant implementation, SceneDelegate/AppDelegate, Info.plist, or pbxproj was edited. The expected parent overlap is the small CommunityApp import/wrapper region.

Exact setup, callback glob patterns, provider dashboard requirements, native registration instructions and transactional-community follow-up gates: `docs/supabase-auth-setup.md`.
