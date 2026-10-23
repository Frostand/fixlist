# Routing and navigation repair implementation plan

**Goal:** Repair N01, N05, N07, N08, N09, N11, N12, N15 and the code portion of U07 without changing the shared saved-state schema.

**Architecture:** Keep typed route decisions in `routes.ts`; use a small separately versioned navigation record for invitation selection, deferred destinations and dismissed guides. Keep resident facts resident-only, focus guides outside the tab shell, and replace print polling with an observer plus cancellable image decoding.

**Tech Stack:** Existing React, TypeScript and Vitest; no dependencies or installs.

## Constraints and acceptance

- Preserve concurrent changes, protected files and `fixlist:demo:v1` schema. No commits, external actions or delegation.
- Keep `?localScan=` as the explicit developer launch exception.
- Use typed English/Spanish keys in one `// routing-nav` block in each dictionary.
- Run regression tests, strict typecheck, full tests and production build. Report browser, VoiceOver, print and Simulator checks separately.

## Tasks (inline execution authorized by the delegation)

- [x] Write regression tests for fragments, launch/person/guide destinations, resource return/active tab, reloadable invitation drafts and their eligibility checks. Implement the matching pure helpers in `routes.ts` and `navigation-state.ts`; connect only navigation sections of `App.tsx`.
- [x] Add static-render tests for fact-free nonresident Resources and focused guides. Remove fallback screening and put the guide in `StartShell`; preserve incomplete progress on skip and offer resume from Help/More.
- [x] Add static-render regression for a question with no concern and distinct previous-question copy. Make only the optional-concern guards and label change in `ResidentScreens.tsx`; no domain changes are needed.
- [x] Test skip-link activation and Help/reset focus targets with small DOM doubles. Connect focus return in `PhoneShell.tsx` and a modal, scrollable reset confirmation in `SettingsScreens.tsx`.
- [x] Test explicit print resolution, failure, decoding, timeout and abort with observer doubles. Replace the readiness loop in `App.tsx`, cancel on navigation/unmount, and check all required commands.

Each task runs its targeted Vitest checks before proceeding. Final acceptance remains with the parent; runtime and native checks need separate evidence.
