# FixList account increment 1

Auth foundation from 2b67d66, with native target integration on parent a2426c9. No cloud project created, credentials supplied, migrations applied, remote writes, purchases, or external sign-in performed. The user explicitly selected a NEW owner-controlled Supabase setup; project creation is waiting for dashboard login. Paid spending is not authorized. No demo data is imported.

## What is implemented

The default community entry is a real-account shell. Explicit local demo mode retains existing filled demos and blank elder/volunteer onboarding. Real auth never calls `domain.signIn`, instantiates the seeded store, or exposes local domain commands as shared features. Real accounts support email/password registration, login, confirmation resend, recovery, Google PKCE, separate Apple web PKCE and native Apple ID-token exchange, plus empty elder/volunteer setup and private profile reload.

`src/auth/types.ts` is provider-neutral. The Supabase adapter keeps tokens out of UI state, verifies cached sessions through backend `getUser`, rejects UID mismatches/unconfirmed/anonymous identities, and queries one profile by that verified UUID. SQL independently enforces ownership. Account role is a preference, not authorization for screening, family, or community operations. Profile outages retain only the verified workspace and show retry/sign-out, never seed fallback. Setup inserts once; profile editing/deletion are not included.

`Workspace.namespace` is JSON `["live", backendOrigin, authUID]`. Sessions/PKCE must restore before UID is known, so their private persistence key is project-scoped `fixlist:live:<encodedBackendOrigin>:auth`. No real profile/workspace data is cached in localStorage. Demos keep their existing `fixlist.community.v1` store (see source for authoritative key). Live mode cannot access demo captures; demo identity/mode switches unmount the account tree, triggering existing capture abort/ownership cleanup. Native integration adds the auth source to the Xcode target, bridge registration, callback scheme and entitlement settings; capture/Assistant implementations are unchanged.

## Reproduce local code checks

Use Node 24.18+ within 24.x and npm 11.x:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm audit --omit=dev
```

These validate code and mocked transports, not live authentication. Current SDK is exactly `@supabase/supabase-js@2.118.0` with lockfile. SDK auth-js source was checked for verifier persistence, backend verification, confirmation resend and code exchange behavior.

## New backend (selected setup, not yet provisioned)

1. Complete dashboard login to create the already-selected NEW owner-controlled project named FixList. Check the plan/billing settings and use the free plan; paid spending is not authorized. No project has been created by this code increment.
2. Apply `supabase/migrations/202610240001_account_profiles.sql` to the intended project only after review. It creates a typed private profile row keyed by FK/PK to `auth.users.id`, RLS for own select/insert, column-limited insert grants, no client updates/deletes, no family/screening/shared tables or state blobs. `auth.uid()` checks use the indexed primary key and initplan form.
3. Run `npm run test:db` and `npm run test:db:runner`. These use disposable in-memory PostgreSQL without Docker or credentials. The unchanged profile migration passes 52 pgTAP assertions for actual roles, grants, RLS, constraints and timestamp defaults; nine runner checks reject failed or incomplete suites. The minimal AUTH fixture supplies synthetic users and JWT session settings, not token verification. For a complete local Supabase stack, use `supabase init`, `supabase start`, `supabase db reset --local` and `supabase test db --local` in a disposable, unlinked directory. Never run test fixtures against a project with real users. Hosted migration application and GoTrue/PostgREST/provider flows remain unverified.
4. Dashboard Authentication → Providers → Email: enable email/password, enable **Confirm email**, disable anonymous sign-in, choose password requirements (UI registration minimum 12 characters), and configure email delivery/rate limits for owner test accounts. Keep the default confirmation/recovery link semantics using `{{ .ConfirmationURL }}`; do not replace them with implicit token-fragment links or a token-hash URL our callback does not implement. Configure SMTP server-side if needed; no email provider credentials in Vite.
5. Dashboard Project Settings → API: copy only project URL and the **publishable** `sb_publishable_...` key into ignored `.env.local` using `.env.example`. Legacy JWT anon keys and secret/service-role keys are deliberately rejected. Local CLI builds must use a local publishable key; never substitute a service-role key.
6. Set `VITE_AUTH_WEB_REDIRECT_URL` to the exact same web origin root, e.g. `https://fixlist.example/` or `http://127.0.0.1:5173/`. Dev port must match the running server. Only HTTPS is allowed outside loopback. The existing Vite allowlist serves the root, so no new wildcard SPA route is needed. Native callback is fixed to `app.fixlist.demo://auth/callback`.
7. Dashboard Authentication → URL Configuration: Site URL = the production web root. Add redirect allowlist entries for only the environments you intend to use:
   - `https://fixlist.example/\?fl_auth=*`
   - `http://127.0.0.1:5173/\?fl_auth=*` (local development only)
   - `app.fixlist.demo://auth/callback\?fl_auth=*` (registered iOS builds only)

   The backslash escapes the literal question mark in Supabase glob syntax; enter the pattern exactly as shown. These allow a random transaction value in the query while keeping host/path fixed. Confirm the query glob roundtrip in the owner project: URL allowlists include query strings. Do not use a wildcard host, arbitrary path or broad `/**` entry. The SDK's experimental `appendPkceFlowIdToRedirects` is not enabled; if enabled later, explicitly add/test `&sb_flow_id=*` variants. Client validation also matches protocol, host, exact path and transaction ID; it rejects token fragments and handles error-only fragments and rejects unexpected/duplicate parameters. Codes are removed from web history before exchange. Provider errors are generic in UI and never logged with their URL/token payload.

## Google (owner configuration)

Google Auth Platform: configure a Web application OAuth client, consent branding/audience and explicit test users, minimal OpenID/email/profile scopes, JavaScript origins for deployed FixList web origins, and Authorized redirect URI **`https://<PROJECT_REF>.supabase.co/auth/v1/callback`** (use your project's exact Auth callback URL if a custom domain is configured). This is the provider-to-Supabase callback, not the app callback. Enable Google in Supabase Auth, enter client ID/secret there only, keep nonce checks on, then set `VITE_AUTH_GOOGLE_ENABLED=true`. Google uses Supabase authorization code + persisted PKCE in both web and the iOS system auth browser. The iOS browser starts only on HTTPS Supabase authorize URLs.

## Apple web (separate owner configuration)

Create/configure an Apple primary App ID with Sign in with Apple, associate a Services ID for the website, verify the website domain, and register **`https://<PROJECT_REF>.supabase.co/auth/v1/callback`** as the return URL. In Supabase Apple provider configuration, use the Services ID and the generated Apple OAuth client secret. Generate/rotate that secret server-side using the Apple Team ID, Key ID and private .p8 key; Apple's web OAuth secret expires and needs rotation. Put none of these secrets in the app. Then set `VITE_AUTH_APPLE_WEB_ENABLED=true`. Web uses Supabase OAuth PKCE, independently of native Apple token exchange.

## iOS integration — source registered; signed-device setup pending

`ios/App/App/FixListAuthPlugin.swift` is registered in App.xcodeproj and `FixListBridgeViewController.capacitorDidLoad()` in SceneDelegate.swift. This is local integration of the auth foundation, not live-auth qualification. Native sign-in still fails closed when `Capacitor.isPluginAvailable('FixListAuth')` is false; there is no localStorage/demo fallback.

Integrated source and remaining owner setup:

1. **Integrated:** `FixListAuthPlugin.swift` has a file reference in the App group, a PBXBuildFile entry and App Sources membership. Existing `CaptureVideoWriter.swift` registration is preserved. Bundle ID remains `app.fixlist.demo` and deployment target remains iOS 15.
2. **Integrated:** `FixListBridgeViewController.capacitorDidLoad()` in **SceneDelegate.swift** registers:
   ```swift
   bridge?.registerPluginInstance(FixListAuthPlugin())
   ```
3. **Integrated:** App Info.plist has `CFBundleURLTypes` with `CFBundleURLName` = `app.fixlist.demo.auth` and `CFBundleURLSchemes` = `["app.fixlist.demo"]`. Existing `SceneDelegateProxy.shared.scene(...)` forwarding for cold `willConnectTo`, warm `openURLContexts` and universal links is preserved. The plugin listens to Capacitor's public URL notifications, retains events until consumed, and reads `ApplicationDelegateProxy.shared.lastURL` for cold delivery. Camera/photo permission copy includes optional silent video up to 30 seconds, local photos/outlines/video and user-chosen photo/outline export or sharing; video export is not implemented.
4. **Local entitlement integrated; owner configuration UNVERIFIED:** `ios/App/App/App.entitlements` contains `com.apple.developer.applesignin` = `["Default"]`; both Debug and Release set `CODE_SIGN_ENTITLEMENTS = App/App.entitlements`. The owner still needs to enable **Sign in with Apple** for the actual registered App ID/bundle `app.fixlist.demo`, select a matching provisioning profile, and configure this bundle ID in the Supabase Apple provider's allowed Client IDs/audiences (alongside the Services ID if using web). Keep `VITE_AUTH_GOOGLE_ENABLED`, `VITE_AUTH_APPLE_WEB_ENABLED` and `VITE_AUTH_APPLE_NATIVE_ENABLED` false by default; enable each only after its matching configuration and verification. With capability/account restrictions missing, Apple returns an error; it never selects a demo.
5. Run `npm run ios:sync`, then rebuild the signed target for provider testing. Keychain uses generic passwords, a bundle-specific service, project-scoped keys, `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, and no shared access group/UserDefaults. Refresh tokens and PKCE secrets use this adapter only; Keychain errors fail closed. Native foreground/background events start/stop SDK token refresh and returning foreground re-verifies an idle account. Keychain data may survive app uninstall; sign out before handoff/reinstall tests.

Apple native creates fresh cryptographic raw nonce + state, sends SHA-256(nonce) to Apple, checks returned state, and passes ID token + raw nonce to Supabase `signInWithIdToken`. Raw nonce is cleared on finish/cancel/120-second timeout; no provider-name/email/Apple client claim becomes an account ID. Browser OAuth has a 10-minute timeout. Cancellation invalidates pending transactions and serializes token mutation before local sign-out; backend token verification remains required.

For integrated build checks, use `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/DerivedData/native-auth-simulator CODE_SIGNING_ALLOWED=NO build`, then repeat with `-destination 'generic/platform=iOS' -derivedDataPath ios/DerivedData/native-auth-device`. Keep the source and bundled model verification phases enabled. Unsigned builds, merged plist inspection and source entitlement checks do not qualify provisioning, provider roundtrips or Keychain/callback behavior on a signed iPhone. See `docs/auth-increment-validation.md` for executed evidence.

## Lifecycle limits and verification gates

- One pending app transaction per project/device; a new registration/resend/reset/OAuth request replaces the older app transaction. Browser persistence/Keychain retains PKCE across reload/cold start. App OAuth transaction expires after 10 minutes, email transactions after 60 minutes; Supabase's own shorter code/link limits still apply. Duplicate delivery is ignored after consumption; expired, mismatched, cancelled or denied returns cannot authenticate. Requests fail closed after storage failure.
- Confirmation/recovery must return to the same device/browser/profile that initiated the latest request. If confirmed elsewhere, ordinary email login may work after confirmation; recovery requires requesting a new link locally. Closing a browser flow may leave a pending transaction; Cancel pending sign-in clears it. Sign out is local to this device, not revocation of every session on other devices.
- Real auth copy is in isolated `src/i18n/auth.ts` with an explicit English fallback/notice. Shared nine-language dictionaries were not touched. Setup reuses existing translated fields, including selected-language direction. Full translated auth is a follow-up.
- Email delivery/confirmation/recovery, Google consent, Apple web/domain/secret rotation, native nonce exchange, warm/cold callbacks, cancellation/timeouts, token refresh/Keychain lock/reinstall, two-account profile RLS and signed-iPhone end-to-end tests are **UNVERIFIED** without owner backend/provider configuration and test accounts/device. Mock transport tests/build/Swift typecheck establish code evidence only.

## Exact follow-up before real community use

Keep live workflows unavailable until jobs/messages/hours are relational server-owned records with RLS and transactional commands: actor = auth.uid; eligibility/screening/family authorization from trusted server tables; atomic job accept/scheduling, participant-only messaging/address access, state transitions and idempotency, elder confirmation and a unique hours-credit ledger. Add adversarial multi-user/RLS/concurrency tests on a local Supabase stack. Profile editing needs a narrow validated own-field command/column grants; account deletion needs an authenticated server operation and cleanup policy. Capture enablement needs a live Workspace-aware store/abort boundary verified against project+UID, without uploading/importing existing demo captures. Do not upload the demo CommunityState JSON or let clients write screening/link/credit authority. A separate owner decision is needed for release/deployment.

## Primary references checked

- Supabase PKCE: https://supabase.com/docs/guides/auth/sessions/pkce-flow
- Backend identity verification: https://supabase.com/docs/reference/javascript/auth-getuser
- Email/password/recovery: https://supabase.com/docs/guides/auth/passwords
- Google: https://supabase.com/docs/guides/auth/social-sign-in/auth-google
- Apple: https://supabase.com/docs/guides/auth/social-sign-in/auth-apple
- RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Redirect allowlists: https://supabase.com/docs/guides/auth/redirect-urls
- Apple nonce: https://developer.apple.com/documentation/authenticationservices/asauthorizationopenidrequest/nonce
- Capacitor 8.5.3 public SceneDelegateProxy/ApplicationDelegateProxy source bundled with the installed official dependency.
