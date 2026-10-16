# Browser integration boundary

No storage or print adapter exists yet. Add real integrations only when the corresponding journey is implemented.

The later demo storage key is `fixlist:demo:v1`. Store only the minimal synthetic demo state in a versioned envelope. Validate parsed data at runtime, including schema version, allowed statuses, IDs, and required fields; TypeScript types alone do not validate JSON. Catch unavailable storage, parse errors, quota errors, and failed writes. Fall back to usable in-memory state with a visible persistence message; never silently claim a save succeeded.

Load the initial fixture when no valid saved state exists. Do not migrate unknown versions blindly or render arbitrary saved content. Reset must remove only FixList's own versioned key, restore a fresh copy of the fixture, and clear confirmation, request, and family-reported completion changes. Never call `localStorage.clear()`.

Private photos, addresses, secrets, credentials, and real household records do not belong in this fixture or storage plan. The origin's browser storage is neither an account nor an access-control system. See [MDN localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).

Later printing should call `window.print()` from a real user action and use `@media print` styles to produce a readable plan with provenance and uncertainty labels. Verify the browser's print preview and saved PDF before recording. There is no PDF-generation dependency. See [MDN printing](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Printing).
