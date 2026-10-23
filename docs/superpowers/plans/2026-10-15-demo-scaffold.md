# FixList Demo Scaffold Implementation Plan

> **For agentic workers:** Execute the authorized scaffold steps below using the executing-plans workflow. Do not expand this task into the complete demo application. Steps use checkboxes to distinguish setup from future product work.

**Goal:** Set up a runnable, small browser project and a video-driven implementation roadmap.

**Architecture:** One React/TypeScript/Vite application with typed synthetic fixtures and pure domain modules. Later interactions will use versioned browser storage and browser printing; no server or external service is required. The initial page is a scaffold status page, not the completed product UI.

**Tech Stack:** React, TypeScript, Vite, Vitest, plain CSS, npm, Node 24. Use exact dependency versions and commit-ready lockfile contents; do not create a commit in this task.

## Global Constraints

- Preserve the existing icon and prior plan; add a supersession note pointing to `docs/architecture.md`.
- Build setup and contracts now. Leave checklist, plan generation, screening, request workflow, and printable output as explicit later milestones.
- Sample homes, assistance programs, and histories must be unmistakably synthetic. No invented real benefits, verified dates, or completed repairs.
- Human confirmation is required for concerns; unknown program facts remain unknown. Local demo status does not represent authenticated volunteers or production privacy controls.
- No API, database, authentication, email, deployment, native capture app, reconstruction worker, or GPU dependencies. Optional 3D is future work and is not installed now.
- No final visual-design decisions or generated assets in this scaffold task.
- Record actual AI assistance and preserve the requirement for significant student contributions and technical understanding before CAC submission.

## Task 1: Runnable toolchain

**Files:** `package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `index.html`, `.gitignore`, `.nvmrc`, `src/main.tsx`, `src/app/App.tsx`, `src/styles/base.css`.

- [x] Create a private ESM package with exact React/React DOM versions, and exact development versions for Vite, its React plugin, TypeScript, Vitest, and React/Node type packages. Resolve compatible Node 24 types.
- [x] Configure TypeScript strict checking, React JSX, bundler module resolution, and no emit. Configure Vite's React plugin and a localhost dev server on port 5173. Use a minimal semantic HTML status page rather than implementing the later product flow.
- [x] Install dependencies and save the npm lockfile. Exclude dependencies, build output, coverage, local secrets, raw private capture assets, and recording exports from Git.
- [x] Provide these commands and document their exact purpose:

```json
{
  "dev": "vite --host 127.0.0.1",
  "build": "tsc -b && vite build",
  "preview": "vite preview --host 127.0.0.1",
  "typecheck": "tsc -b --pretty false",
  "test": "vitest run --passWithNoTests",
  "test:watch": "vitest"
}
```

**Acceptance:** `npm run typecheck` and `npm run build` succeed. An empty test suite is reported honestly; configuration is not test coverage.

## Task 2: Typed sample-data and storage boundaries

**Files:** `src/domain/types.ts`, `src/data/demo-scenario.ts`, `src/lib/README.md`, `public/demo/README.md`.

**Interfaces:** `DemoScenario` describes synthetic rooms, unconfirmed concern evidence, reference actions, fictional program criteria, and family-recorded request data. `CriterionStatus` is exactly `'met' | 'not_met' | 'unknown'`. `ScreeningStatus` is exactly `'criteria_matched' | 'needs_information' | 'known_criterion_not_met'`. Export the scenario as `demoScenario` using `satisfies DemoScenario` so it is checked at compile time.

- [x] Define only the domain types required to describe that future demo journey. Keep evidence distinct from confirmation, and source/verification status distinct from a fictional fixture.
- [x] Create a small synthetic scenario that the status page can import. Start concern confirmation as false and request completion as unconfirmed. Do not point to missing photos or simulate real approvals.
- [x] Document the later `fixlist:demo:v1` storage key, schema validation, error handling, reset behavior, and the rule that private photos/secrets do not belong in storage fixtures. Do not add a pretend storage adapter.
- [x] Document where consented or synthetic recording assets go and how provenance will be recorded. Preserve the original `assets/icon.svg`.

**Acceptance:** Fixtures typecheck and render on the status page as synthetic. No unimplemented service or product interaction is presented as working.

## Task 3: Current stack and video roadmap

**Files:** `README.md`, `AGENTS.md`, `docs/architecture.md`, `docs/video-shot-list.md`, `docs/ai-disclosures.md`, `recordings/README.md`, supersession note in `fixlist-plan.md`.

- [x] Make `docs/architecture.md` the current technical authority. Explain each chosen dependency, local-only demo boundaries, feature-to-file ownership, the storage/print plan, commands, and deferred production systems. Reference the official Vite, Vitest, browser-storage/printing, and CAC sources already checked in this session.
- [x] Define three later milestones: (1) sample room/checklist/confirmation/real plan computation; (2) verified program records with unknowns/family request log/print; (3) resettable recording journey, relevant domain tests, disclosures, and video. Each milestone needs observable behavior and a stop/cut criterion.
- [x] Map a 1-to-3-minute video to future screens and required evidence. Distinguish genuinely computed behavior from synthetic facts, preprocessed assets, and family-reported status. Do not claim the scaffold is ready to film.
- [x] Write project instructions with actual commands and definition of done. Keep the global routing policy, distinguish supported Astra/Sol/Luna routing from unavailable Opus/Sonnet roles, and prohibit silent specialist substitution or new handoff chats.
- [x] Record today's AI-assisted planning/scaffold work as actual assistance. Leave student contributions as not yet recorded rather than fabricating them.

**Acceptance:** The README offers a clear start command and points to one current architecture. The old plan is preserved but explicitly superseded where it requires the production stack.

## Task 4: Proportionate verification

- [x] Run `npm run typecheck`, `npm run build`, and `npm test`; report that no domain tests exist yet if the suite is empty.
- [x] Start `npm run dev`; inspect the minimal page through the T3 collaborative preview and check for runtime errors.
  - Root verified the T3 preview at `http://127.0.0.1:5173/`: title `FixList demo scaffold`, correct synthetic counts and zero confirmations, no console warnings/errors, and no failed network entries. Vite connection debug messages only. The dev server remains running.
- [x] Review the changed files and dependency tree, and confirm the existing plan/icon were preserved. Do not deploy, create a PR, or build the complete product flow.

**Completion report:** Describe scaffold contents, chosen stack, exact checks performed, commands to run, and what remains to implement before recording. State no performance or product-functionality claim beyond observed evidence.
