# Runtime validation and storage evidence

Implemented in `src/lib/demo-storage.ts` with no new dependencies. The adapter stores only `DemoState` under `fixlist:demo:v1`, version 1, with a 64 KiB UTF-8 JSON bound. There is no migration or automatic recovery write.

## Exported API

- `DemoStorage`: injectable `getItem`, `setItem`, and `removeItem` interface.
- `DEMO_STORAGE_KEY`, `MAX_SERIALIZED_BYTES`: exact key and byte limit.
- `validateState(value, scenario)`: `{ ok: true, state } | { ok: false, error }`.
- `loadDemoState(storage, scenario)`: `{ status: 'loaded' | 'empty' | 'invalid' | 'unavailable' | 'error', state, message }`.
- `saveDemoState(storage, scenario, state)`: `{ status: 'saved' | 'invalid' | 'unavailable' | 'error', message }`.
- `resetDemoState(storage, scenario)`: `{ status: 'reset' | 'unavailable' | 'error', state, message }`.
- `getBrowserStorage(browser?)`: returns the narrow storage interface or `null`; default acquisition of `window.localStorage` is guarded. An optional injected host permits a denied-getter test.

Validation reconstructs fresh records after checking exact keys, known IDs, enum values, canonical timestamps, fixed family/helper attribution, fixed request note/source, confirmation prerequisites, unique deterministic request/action IDs, and completion coherency. A draft cannot be complete; unconfirmed records cannot have attribution/time. Unknown stored catalog/evidence/text fields are rejected. Valid inactive request history remains loadable, including a retained completion before a later reconfirmation. Plan and screening output are recomputed by the domain.

Load never writes/removes data. Invalid/malformed/oversized/denied data falls back to fresh memory with an explicit message. Save validates before writing and reports quota/denied-write errors. Reset returns fresh memory even when removal fails, removes only the own key when permitted, preserves unrelated keys, and warns when reload may restore older saved data. The UI must display these messages and avoid saving automatically on mount/reset.

## Executed checks

- `npm test -- src/lib`: 96 tests passed in one test file. The suite contains ordinary valid/invalid schema cases, canonical date/attribution checks, confirmation and request coherency, 64 KiB and UTF-8 byte boundaries, malformed JSON, denied acquisition/read/write/remove, absence/unavailable storage, fresh reset, and unrelated-key survival.
- One integration test enumerated **5,184 reachable fixture states**: 4 final answer/confirmation modes for each of 2 concerns × 6 request-history modes for each of 2 actions × all 9 criterion-answer pairs. Histories were constructed through real `applyCommand` transitions while active, then confirmations/answers were changed to obtain active or inactive history. Every state passed validation, save, and load; loaded state matched the command result; plan action IDs matched only explicitly confirmed modes; request activity matched plan membership; and screening matched an explicit 9-case truth table. This is a bounded fixture composition check, not an enumeration of every possible command history or timestamp.
- Additional composed round trips cover completion, revocation, later reconfirmation, reopening, status progression, and both active/inactive completion history.
- `npm run typecheck`: passed. An initial callback-narrowing diagnostic was corrected with a guarded reconstruction loop before the final passing run.

The validation scope is JSON state for this fixed, trusted authored catalog. It does not establish validation of future arbitrary network commands or untrusted catalogs. These are Node/Vitest tests using injected storage, not browser permission/quota measurements. Actual browser journey, persistence/reload/reset integration, and visible error messaging remain primary acceptance work. No app-latency, privacy certification, or real household outcome claim follows from these checks. No domain, UI, fixture, dependency, Git history, or external service was changed by this task.
