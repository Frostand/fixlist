# Supabase account increment — d7ba049

Objective: a separately reviewable real-auth/account foundation; no cloud project, spend, credentials, demo import, shared-workflow conversion, or push.

## Code findings and decision
The current CommunityApp/useCommunity creates a durable seeded local store. `domain.signIn` selects a fictional ID. Reusing it for real sessions would grant fabricated data and authority. Keep it in explicit demo mode. Put a provider-neutral authenticated account shell above it; real sessions never instantiate the demo controller. Existing captures remain local and unavailable in real mode for this increment.

## Implementation sequence
1. Write red lifecycle and account isolation tests; install pinned official Supabase JS dependency.
2. Implement config validation, project-scoped persistent PKCE/session storage, exact callback validation/transaction expiry/replay/cancel handling, backend getUser verification, abort/generation guards, and durable profile gateway.
3. Add actual email/OAuth/recovery/setup/account UI; preserve filled/blank demos with explicit labels. Remount demo component trees on account/mode switches so existing capture cleanup invalidates ownership.
4. Add own iOS Keychain/Apple nonce/OAuth plugin source, without capture/Assistant/pbxproj edits. Return exact registration instructions; native unavailable without registration/config.
5. Prepare profile migration, RLS tests, owner setup/provider callback instructions and follow-up gates. Run focused tests, typecheck/build, available native/static checks; commit scoped changes.

## Acceptance
- Real identity derives from Supabase getUser, never user-selected ID/name/email or unverified cached session.
- Zero seed/domain shared commands in real mode; one profile per verified auth.users UUID; role setup is elder/volunteer only. No client-controlled links or screening.
- Storage separates mode/project/UID; secrets never logged. Native refresh/PKCE storage uses Keychain only.
- Confirmation, recovery, email errors, OAuth callbacks, cancellation, expiry, replay, identity changes and stale async results fail closed, with mock/actual UI handler tests.
- Setup persists elder/volunteer fields under verified UID; failed profile access does not show demo content.
- SQL/RLS execution requires already available local Supabase; otherwise explicitly unexecuted.
- Live provider roundtrips, native plugin target registration/signing and signed iPhone checks remain external prerequisites, distinct from local evidence.

## Completed local increment

Implementation and local verification are recorded in `docs/auth-increment-validation.md`. Owner cloud setup, SQL execution and native target/provider/device integration remain explicit prerequisites in `docs/supabase-auth-setup.md`; the live shared-workflow conversion remains gated and disabled.
