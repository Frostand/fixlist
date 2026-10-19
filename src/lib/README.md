# Browser integration boundary

`demo-storage.ts` owns `fixlist:demo:v1`; the key name is independent of the payload version. New saves use `{ format: 'fixlist-saved-v1', revision, state }`, with a positive envelope revision and schema-5 `DemoState`. The complete envelope plus reserved bytes for privacy exits must fit 64 KiB of UTF-8 JSON. Plans, screening results, catalog data and media bytes are derived or stored separately, never embedded in saved household JSON.

## Household persistence

`DemoStorage` supplies `getItem`, `setItem` and `removeItem`. `getBrowserStorage` safely acquires localStorage and returns null when denied. Tests inject adapters; no service or backend is involved.

| Function | Contract |
| --- | --- |
| `validateState(value, scenario)` | Strict current-schema reconstruction or a typed invalid/capacity result. |
| `loadDemoState(storage, scenario)` | `loaded`, `migrated`, `empty`, `invalid`, `unavailable` or `error`, with state and an explanatory message; never writes. |
| `saveDemoState(storage, scenario, state, expectedToken?, isCurrent?)` | Async: validates the payload, then checks cancellation, saved-byte token and budget and increments the envelope revision inside the shared exclusive lock. Resolves to a durable save token or typed failure. |
| `resetDemoState(storage, scenario)` | Async removal of both owned household/navigation keys under the same lock; reports failure and returns initial state. |
| `resetFixListData(storage, scenario)` | Holds that lock through metadata removal and photo/scan reset, attempting both private stores even if another fails; reports partial failure. |

The async UI dispatcher retains the exact observed saved bytes as its optimistic token. Stale edits require refresh, which also uses the exclusive `fixlist:demo:v1:write` Web Lock. Screens and media handlers await persistence before publishing success, navigating or clearing forms; repeated activation while saving is ignored. Unavailable/unreadable storage, invalid saved bytes and failed writes fail closed: no successful household change is published in memory. Recovery offers export, refresh and deliberate reset rather than silently overwriting rejected data. Without `navigator.locks`, the previous compare-then-write fallback remains supported and retains a window where simultaneous tabs can overwrite one another; see `docs/architecture.md` and the deterministic fallback/lock tests. This is not a server transaction or authenticated access control.

Validation reconstructs exact plain data fields, dense bounded arrays, fixed fictional identities, roles/grants, canonical timestamps, confirmation prerequisites and known catalog IDs. Request episodes distinguish recurring concerns from historical completion; deterministic request IDs include ordinals after the first request. Professional-referral records are local human-reported `recorded` / `contacted` / `closed` stages and cannot assign professional work to volunteers. Event replay checks proposals, agreement, progress, completion and referral aggregates; typed failures distinguish permissions, conflicts, capacity and unavailable storage.

The live photo index supports 64 photos independently of deletion history. The newest 32 deleted-photo attribution records retain contributor and remover identity/time; older records are dropped with `removedPhotoHistoryTruncated: true`, disclosed in the photo UI. Deleted blobs are not retained by this log. The resident may remove household photos; contributors may remove their own after access revocation. Completed volunteer assignments receive no shared fields or future photos.

## Migrations and recovery

Bare supported payloads and valid revisioned envelopes are accepted. Frozen v1/v2 contracts in `legacy-demo-state.ts` preserve supported answers/confirmations and keep family request status/completion only as inactive legacy history on an unassigned draft. No volunteer acceptance, repair verification or facts are inferred from old criterion statuses. v3 gains request episodes and deletion attribution. v4 validates every old deletion record before limiting history to 32 entries and setting the truncation flag when needed. All migrations produce schema 5 in memory; original bytes remain until a successful explicit save. Existing envelope revisions continue rather than restarting. Unknown/malformed schemas, accessors, symbols and extra fields are rejected. Proxy objects are outside the JSON boundary.

`demo-storage-legacy-fixture.json` is synthetic test-only original v1 data, not a household export. Recovery/loading never automatically writes initial state or replaces invalid bytes.

## Navigation and private media

`src/app/navigation-state.ts` owns the separate bounded version-1 `fixlist:navigation:v1` key for invitation drafts, pending routes and skipped-guide IDs. Draft recovery rechecks resident, request revision, current action and volunteer eligibility; reset clears this key. It is not a remote invitation or household payload.

`photo-storage.ts` re-encodes user-selected images into fresh JPEG pixels, downsized to 1600 px, in `fixlist-photos` / `jpeg-blobs`. `scan-storage.ts` stores scan documents separately in `fixlist-scan` / `local-scan`. Both retain `__reset_generation` inside their owned stores: a transaction from an older client generation is refused after reset. Local queues serialize operations; the dispatcher invalidates in-flight work, and compensation must not restore reset blobs/metadata. Reset only touches owned stores and keys. Imported media, pins and photos are deleted; installed bundled demo scans remain available as app assets. Partial deletion failures are reported.

Scan import and `loadScan` await format/complexity preflight and actual Blob SHA-256 validation before publishing suggestions. Identity is never inferred from splat count or a serialized hash cache. Pin and display boundaries recheck `validateSuggestionScene`; `SCENE_IDENTITY_MISSING`, `SCENE_IDENTITY_UNVERIFIED`, `SCENE_IDENTITY_MISMATCH` and `SCAN_COMPLEXITY` remain typed through storage and localized UI. Unbound legacy v1/v2 suggestions must be regenerated or explicitly bound with `scan/bind_scene_identity.py`; the scene can be imported alone. Supported imports are `.splat` and bounded scalar-vertex PLY, capped at 64 MiB / 1.5 million splats; compressed SPZ/KSPLAT and unsupported PLY fail closed. Approximate localization is labelled and photo-only suggestions offer no 3D placement. Scan-storage failures separately explain that optional scan edits may exist only in memory.

No media is uploaded. Origin-local storage is not an account, backup, sync or security boundary against someone with access to the device. Browser reload/error/reset, iOS Simulator, physical-device, VoiceOver and usable print/PDF acceptance remain separate from these deterministic contracts. Browser printing uses the native print dialog and the checked stylesheet; the existing iOS bridge is a separate runtime path. No new device or print qualification is claimed here.
