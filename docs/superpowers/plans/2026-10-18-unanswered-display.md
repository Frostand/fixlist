# Unanswered Answer Display and Prototype Icons Implementation Plan

> **For agentic workers:** Execute inline under the bounded parent delegation; no further delegation or Git mutations. Parent owns acceptance.

**Goal:** Separate unanswered from explicit Not sure in checklist presentation and distinguish the two prototype tab icons.

**Architecture:** Derive a fourth display value from existing answers/attribution in a pure app helper. Use it for phone, print and retained legacy checklist/map surfaces; use an app-only unanswered selector for resume. Keep domain answers, confirmation, selectors, schema and projections unchanged.

**Tech Stack:** Existing React/TypeScript/Vite/Vitest; no installs or dependencies.

## Constraints and acceptance

- Preserve the existing uncommitted navigation prototype and current/volunteer icons.
- Never turn unanswered or Not sure into No, Yes, confirmation or a safety claim.
- Keep typed English/Spanish parity, existing capability gates and the 250 KiB initial JS gzip budget.
- No domain/schema edits, commits, publishing or external actions. Browser/Simulator/print output remain separate parent checks.

## Steps

- [x] Add regression tests for initial/unattributed unknown, explicit unknown, Yes/No, coverage, print, helper access, resume, unchanged confirmation and icon routing; reproduce the current failures.
- [x] Add `src/app/checklist-presentation.ts`; wire phone, report, coverage and retained legacy surfaces. Add only typed copy needed for the display states, progress and uncertainty follow-up.
- [x] Add door/person stroke icons and select them only for prototype tabs.
- [x] Run targeted tests, typecheck, build and the full test command; if localhost binding is prohibited, run the existing HTTP-suite exclusion and state that limit.
- [x] Record exact strings, follow-up file changes, validation and pending runtime checks; leave the work uncommitted.
