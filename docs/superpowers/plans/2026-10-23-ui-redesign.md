# FixList UI Redesign Implementation Plan

> **For agentic workers:** Execute inline in this bounded worker; delegation and commits are prohibited by the supplied task.

**Goal:** Implement the supplied October 23 redesign brief for the local iPhone-sized journey.

**Architecture:** Keep domain commands, persistence, capture contracts and hash routes. Add presentation primitives, collapse the navigation comparison to one layout, and compose visual setup and room screens around existing commands.

**Tech Stack:** React, TypeScript, Vite, plain CSS, Vitest; no dependencies added.

## Global Constraints

- Preserve confirmation, AI provenance, volunteer projection, reset and print invariants.
- Do not edit ios/, domain rules, protected capture libraries, package manifests, scan/, or scripts/promo/.
- Render languages only from LANGUAGES. Keep English and Spanish keys complete and use logical CSS.
- No commits, uploads, sends, deployments or installs. Browser and Simulator acceptance remain parent gates when unavailable here.

### Task 1: Visual system

- [x] Replace font imports/tokens in src/main.tsx and src/styles/base.css; standardize phone.css.
- [x] Add src/app/UI.tsx for grouped rows, cards, buttons, segments, pills, progress, empty states and sheets; extend PhoneShell icons.
- [x] Run `npx tsc -b --pretty false` and existing UI checks before navigation changes.

### Task 2: Navigation

- [x] Collapse navigation-layouts.ts to Home / Rooms / Fix list / Help; preserve legacy saved layout values as inert compatibility values.
- [x] Update PhoneShell, routes.ts and App.tsx for large-title roots, avatar/settings, compact pushed headers and correct parents.
- [x] Update navigation-layouts.test.ts, navigation-layouts-ui.test.tsx and route expectations to assert the single layout, stable hashes, grants and volunteer tabs.
- [x] Run focused navigation tests and typecheck.

### Task 3: Setup

- [x] Add inline SVG illustrations and welcome/language, role selection, three role-specific panels, privacy completion.
- [x] Reuse guideProgress, set_onboarding and dismissal navigation state; final scan goes through the same durable completion path.
- [x] Add focused setup tests for language enumeration, role choices, panel content, persistence callbacks and completion destination.
- [x] Run setup, roles and navigation tests and typecheck.

### Task 4: Core screens

- [x] Rebuild ResidentHome and RoomList with capture summaries and a scan action.
- [x] Rebuild RoomPage presentation around existing capture operations; preserve flags, exact photo questions and separate checklist confirmation.
- [x] Rebuild settings grouped rows; compact recovery details; retain reset sheet, print and grant gates.
- [x] Run capture, lifecycle, roles, localization and focused new tests.

### Task 5: Remaining presentation and integration

- [x] Polish Fix list, Help resources and volunteer presentation with existing commands.
- [x] Run strict typecheck, full Vitest and production build. Inspect budget output and protected-path diff.
- [x] Attempt Vite on 127.0.0.1:5174 and browser screenshots at 402x874 without installing tools; report sandbox limits.
- [x] Write a concrete implementation report with all modified test files, counts and remaining parent acceptance gates.

Browser attempt: Vite listen on 127.0.0.1:5174 failed with sandbox EPERM. Runtime, keyboard, print and Simulator acceptance remain with the parent. Full Vitest has 1382 passing tests and 156 boundary tests blocked by the same socket restriction.

Final evidence: 1354 tests pass with both environment-affected local-server/packaging suites excluded. Earlier full native-loader execution passed 1382 tests and blocked 156 boundary cases. A later npm-driven packaging run hit 12 shared-cache EPERM failures. See the implementation report; full test acceptance remains pending.
