# Browser integration boundary

`demo-storage.ts` implements the storage adapter. Its only key remains `fixlist:demo:v1`, exported as `DEMO_STORAGE_KEY`; the key name is independent of the envelope version. New saves contain the version-2 `DemoState`: `schemaVersion`, `scenarioId`, `checklistAnswers`, `confirmations`, `profileId`, and `requests`. Facts, profile objects, criterion answers, rule trees, computed plans, screening results, room content, and catalog records are rejected. Both loading and saving enforce `MAX_SERIALIZED_BYTES` (64 KiB of UTF-8 JSON).

## API and integration

`DemoStorage` needs only `getItem(key)`, `setItem(key, value)`, and `removeItem(key)`. All adapters accept this interface or `null`/`undefined`; tests inject an in-memory fake. `getBrowserStorage()` safely acquires `window.localStorage`, including environments where reading the property throws. It returns `null` when unavailable and accepts an optional storage host for testing.

| Function | Result |
| --- | --- |
| `validateState(value: unknown, scenario)` | Strict v2 validation: `{ ok: true, state }` with reconstructed state, or `{ ok: false, error }`. |
| `loadDemoState(storage, scenario)` | `{ status, state, message }`; status is `loaded`, `migrated`, `empty`, `invalid`, `unavailable`, or `error`. |
| `saveDemoState(storage, scenario, state)` | `{ status, message }`; status is `saved`, `invalid`, `unavailable`, or `error`. |
| `resetDemoState(storage, scenario)` | `{ status, state, message }`; status is `reset`, `unavailable`, or `error`. Every result contains fresh initial state. |

Load once, put the returned state in memory, and display its message. Successful user commands may then call `saveDemoState`; display that result rather than assuming a save succeeded. Loading never writes or removes data, including migration and rejected saved data. Do not add an automatic effect that saves the initial/recovery/migrated state on mount.

Always use the state returned by reset, even when removal fails. Reset removes only the FixList key; it never calls `clear()`, reads another key, or writes initial state. A failed reset explicitly warns that reload may restore older data. Do not automatically save after reset or after a failed reset; later explicit user edits may attempt a save.

## Validation and retained history

Validation requires exact known keys and catalog IDs, an allowlisted fictional profile ID, supported enums, fixed synthetic attribution/helper/note/source fields, and canonical ISO UTC dates. A confirmation requires all backing checklist answers to be `yes` and a valid authored evidence chain. Unconfirmed records cannot carry attribution or dates; draft requests cannot carry a completion report. Each action has at most one request with its deterministic ID. Requests must be a bounded, dense data array. The public validator rejects accessors, symbols, class objects, and extra fields without evaluating getters; proxy objects are outside the JSON boundary.

This boundary validates JSON state against a fixed trusted authored catalog. It does not validate future arbitrary network commands or untrusted catalog data.

Requests may remain as inactive history after confirmation is revoked. Validation preserves them; the domain computes their activity. A retained completion can predate a newly recorded confirmation, so timestamp order between them is deliberately not treated as invalid. That report never proves a new concern is resolved. The validator constructs fresh records from trusted IDs/constants and accepted enums/timestamps; arbitrary saved text, markup, evidence, source labels, and computed output never become UI data.

## Exact version-1 migration

Only the original `fictional-maple-house` v1 envelope is supported: exactly two checklist IDs (`rug-check`, `cord-check`), their two concern IDs, the original `fictional-maple-support` program with `fictional-area`/`fictional-residency` statuses, and requests for `review-rug`/`review-cord`. These legacy ID sets stay fixed even as the trusted current catalog grows. Every old field, status, confirmation prerequisite, request, source, attribution, and timestamp must pass validation before any migration is accepted. Partial shapes, added current IDs, unsupported versions, or malformed data return a fresh in-memory state and leave the saved bytes unchanged.

A successful legacy load returns `status: 'migrated'`, reconstructs v2 state in memory, preserves the original answers/confirmations and valid active or inactive request history, and seeds all six new questions as unknown and new confirmations as false. It selects `unknown-profile`. Old manually assigned screening statuses are validated and discarded: they cannot establish facts or identify a profile. The returned notice explicitly asks the user to select a fictional profile to screen again. A later successful explicit edit/save can replace the v1 bytes with v2; repeated loads alone never upgrade storage. `validateState` and `saveDemoState` accept v2 only.

`demo-storage-legacy-fixture.json` is test-only synthetic data: the exact original browser-generated v1 fixture captured before migration. It contains no private household data and is imported only by the storage test suite.

Private photos, addresses, secrets, credentials, and real household records do not belong in this demo. Origin-scoped browser storage is not an account or access-control system. Browser runtime reload/reset/error handling is a separate acceptance check from the adapter tests. See [MDN localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).

Printing should call `window.print()` from a real user action and use `@media print` styles. Check print preview and a saved PDF before recording. There is no PDF-generation dependency. See [MDN printing](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Printing).
