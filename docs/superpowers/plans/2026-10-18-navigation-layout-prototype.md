# Navigation Layout Prototype Implementation Plan

> **For agentic workers:** Execute inline under the bounded parent delegation; no further delegation or Git mutations are authorized. Use executing-plans for task-by-task verification.

**Goal:** Compare current, three-tab and four-tab resident/helper navigation without changing household data or permissions.

**Architecture:** Keep existing route names and screens. A pure navigation-layouts module owns tabs, labels, capability gates and nested-route selection. The existing versioned navigation record stores the choice separately from household state; App supplies it to the shell and screens.

**Tech Stack:** Existing React/TypeScript/Vite/Vitest; no dependencies or installs.

## Global Constraints

- Default current navigation and all volunteer navigation retain their existing behavior.
- No household schema/domain edits, new dependencies, uploads, external sends, commits, branches or history changes.
- Keep strict English/Spanish key parity, keyboard controls, headings, focus behavior and 250 KiB gzip initial JS budget.
- Preserve grant checks, confirmation separation, professional restrictions and volunteer projections.
- Browser and iOS Simulator checks are distinct from deterministic validation; parent owns acceptance.

### Task 1: Pure navigation and separately persisted preference

**Files:** create `src/app/navigation-layouts.ts` and its tests; modify `src/app/navigation-state.ts`, its tests and `src/app/routes.ts`.

**Interfaces:** `NavigationLayout = 'current' | 'three' | 'four'`; `navigationTabs(layout, role, capabilities)` returns tab definitions with disabled state; `navigationActiveTab(layout, route, returnTo)` returns the selected screen or null. `NavigationState.layout` defaults to current when absent from a valid older record. `navigationLayoutParameter(search)` validates a launch override.

- [x] Test exact tabs, nested mappings, volunteer invariance, helper gates, old/invalid records, preference round trips and reset.
- [x] Implement definitions and optional layout-aware Back/root behavior while preserving old function defaults.
- [x] Run `npx vitest run src/app/navigation-layouts.test.ts src/app/navigation-state.test.ts src/app/routes.test.ts` (included in the successful targeted and fallback runs).

### Task 2: Wire shell, settings and task screens

**Files:** `src/app/PhoneShell.tsx`, `App.tsx`, `SettingsScreens.tsx`, `ResidentScreens.tsx`, `RequestScreens.tsx`, `src/i18n/en.ts`, `src/i18n/es.ts`, new UI tests.

**Interfaces:** optional `layout` defaults to current in reused components. App persists launch/toggle choices with the existing locked navigation updater. Settings contains a native labelled prototype selector. The new header account entry replaces the person switch entry and opens More. Existing Help remains linked from settings and its disclosure is shown there. Requests includes resources even without request permission; unauthorized request records remain hidden.

- [x] Add typed labels and conditional shell/settings entries with current rendering preserved except the requested prototype control.
- [x] Reuse the confirmed plan action button in compact Home cards; do not show unconfirmed concerns inline. Add Rooms scan entry and Requests resource entry.
- [x] Test rendered destinations, settings/header entry, en/es labels, restricted helper output, Home variants and primary action behavior.
- [x] Run targeted navigation/UI/i18n tests and typecheck.

### Task 3: Verification and parent handoff

**Files:** add a scoped implementation report under `docs/`.

- [x] Run `npm run typecheck`, `npm run build`, `npm test`; if the HTTP boundary suite cannot bind in this sandbox, run the supplied exclusion and report both outcomes.
- [x] Inspect diff for protected/unrelated files, default/volunteer invariance, pending asynchronous persistence/reset and lazy scan loading.
- [x] Report test counts, initial gzip, exact en/es tabs, destination inventory and outstanding browser/Simulator checks. Leave changes uncommitted for parent acceptance.
