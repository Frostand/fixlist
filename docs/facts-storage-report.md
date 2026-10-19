# Schema-v2 storage implementation evidence

Implemented October 17, 2026 within the assigned storage boundary. The primary must independently review the source and integration behavior before acceptance.

## Change and interface

- `src/lib/demo-storage.ts` accepts/reconstructs only v2 editable state: the eight catalog checklist/concern IDs, one allowlisted fictional `profileId`, and validated family request records. It rejects facts, profile objects, criterion answers, rules, derived results, and arbitrary extra fields.
- The storage key remains exactly `fixlist:demo:v1`; `schemaVersion` in new saves is 2. The existing storage acquisition, error, reset, and UTF-8 64 KiB boundaries remain in place. Dense request arrays and plain data records reject accessors, class objects, symbols, sparse arrays, and extra array properties without evaluating getters.
- `validateState` and `saveDemoState` remain current-schema-only. `loadDemoState` adds the `migrated` status. Exact original v1 IDs are fixed locally and do not expand with the new catalog. The complete legacy shape, criterion enums, confirmation prerequisites, fixed synthetic request text/source/attribution, lifecycle consistency and dates are validated before migration.
- Migration reconstructs a v2 state, preserving original rug/cord answers, confirmations, and all valid active/inactive/completed request history. New questions remain unknown, new concerns unconfirmed, and the profile is `unknown-profile`. Legacy screening statuses are discarded without inferring facts. The returned notice says they were not converted to facts and asks for a fictional profile selection.
- Load/migration never writes/removes. Only a later successful explicit edit followed by save upgrades bytes. Malformed/future/partial legacy data falls back in memory without changing saved bytes. Reset only removes the exact FixList key and never writes initial state, including on deletion failure.
- `src/lib/demo-storage-legacy-fixture.json` copies the exact synthetic browser fixture from the pre-change baseline; `cmp` verified byte equality. It is test-only and has no dependency on `/tmp` at test/runtime.
- `src/lib/README.md` documents the current envelope, new load status, exact migration boundary and caller responsibilities. No domain/data/UI, print, dependency, lockfile, original plan/icon, or owner files were edited by this worker.

## Validation

Node 24.18.0 and npm 11.16.0.

| Check | Result |
| --- | --- |
| `npm test -- src/lib/demo-storage.test.ts` | 132 tests passed. Includes 4,032 bounded rug/cord concern/history/profile combinations while the six new questions remain unknown; separate full confirmation/completion/history round trips for each of eight concerns; 144 legacy history/activity combinations; all nine original screening-status pairs; exact original browser bytes; explicit successful/failed save upgrade; malformed legacy/current payloads; storage acquisition/read/quota/write/delete failures; unrelated-key survival; exact 64 KiB current/legacy boundaries and UTF-8 byte limits. |
| `npm run typecheck` | Passed after correcting a test-only array-subclass constructor call. No remaining diagnostics at this check. |
| Whitespace checks | Tracked README diff passed `git diff --check`. Separate `git diff --no-index --check /dev/null` checks of the untracked implementation, tests, and this report produced no whitespace diagnostics (exit 1 denotes the new-file differences). |
| `cmp src/lib/demo-storage-legacy-fixture.json /tmp/fixlist-facts-baseline-2026-10-17/legacy-browser-state.json` | Passed; exact synthetic fixture bytes preserved. |

## Limits and remaining acceptance

This evidence establishes the storage adapter and domain-integrated test behavior, not browser, native print, or full-app acceptance. The primary owns the full-suite/build/diff review and actual browser migration/reload/reset/failure checks. Current shared type/data/workflow interfaces were frozen by the catalog worker before integration; no API conflict was found. The trusted catalog remains code rather than untrusted browser data. Browser storage is origin-local synthetic persistence, not an authenticated account or production audit trail. No commit, branch promotion, deployment, upload, external send, or added dependency occurred.
