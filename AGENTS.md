# FixList working instructions

## Objective and scope

Build one small local browser demo that can support an honest 1–3 minute video. The current implementation is a working synthetic local journey, not the full product. Read `docs/architecture.md` before changing scope and `docs/video-shot-list.md` before implementing a recording flow. Preserve the existing `assets/icon.svg` and the body of `fixlist-plan.md`.

## Model routing

Follow Andrew's current global agreement in `/Users/al1234/.codex/AGENTS.md`. The callable collaboration tooling for this setup supports `gpt-6-astra` at `xhigh` for evidence-based decisions and final acceptance, `gpt-6.1-sol` at `xhigh` for substantive implementation, and `gpt-6-luna` at `xhigh` for narrowly bounded work. Select and verify supported routing controls; this file does not switch the running model or reasoning level.

The global roles also specify `claude-opus-5-5` at `xhigh` for open-ended alternatives and `claude-sonnet-5-5` at `high` for communication. Those Claude models are unavailable through this session's callable routing tools. Report a required-role blocker and use only an existing authorized handoff when available. Do not silently substitute, install routing tools, or create new chats. Bounded technical setup may continue where it does not depend on an unavailable role.

Delegate only concrete independent work that benefits from it; do not spawn a worker just to run a command. Use no more than three concurrent spawned workers. An Astra reviewer must inspect delegated changes and deterministic evidence before acceptance; a completion message is not acceptance evidence.

## Architecture and commands

- One React/TypeScript/Vite ESM project; plain CSS; Vitest for meaningful domain and storage tests.
- `src/app`: app composition, native controls and the printable report.
- `src/domain`: types, immutable commands and pure confirmation/plan/screening logic.
- `src/data`: synthetic fixtures and, later, separately sourced program records.
- `src/lib`: validated browser storage and print snapshots; no placeholder services.
- `public/demo`: assets safe to publish, with documented provenance.
- `docs`: architecture, video requirements, assistance disclosures, and implementation plans.
- `recordings`: ignored local exports; keep its README tracked.

Use Node 24.18.0 and npm 11. Run `npm ci`, then `npm run dev` (127.0.0.1:5173). Required checks: `npm run typecheck`, `npm run build`, and `npm test`. `npm run preview` serves the built app at 127.0.0.1:4173. `npm test` requires real tests; the former `--passWithNoTests` flag is removed. Read `docs/validation-facts-catalog-2026-10-17.md` for current facts/catalog/migration evidence and `docs/validation-2026-10-17.md` for historical core evidence.

## Constraints

- Keep exact direct dependency versions and the npm lockfile. Add dependencies only for demonstrated needs. No backend, authentication, server database, email, analytics, or external service in this demo scope.
- 3D room scan (authorized by Andrew, 2026-10-17): an offline local pipeline in `scan/` (ffmpeg + pycolmap + Brush on the developer's Mac) turns a walk-around phone video into a Gaussian-splat file; the app imports it locally into IndexedDB and renders it lazily with three.js + Spark. Scans and source videos stay in gitignored `private-captures/`, are never uploaded, and never go in `public/` or Git. Pins in the scan are user-placed location notes linked to concerns: they are not hazard detection and never confirm a concern. Units are arbitrary unless measured; make no dimension or accuracy claim.
- Evidence and human confirmation are separate. Only confirmed concerns may enter the computed plan. The app does not certify a home as safe or provide a complete assessment.
- Fictional programs must say they are fictional, use synthetic source status, and have no invented verification date. Missing answers remain `unknown`; criteria matching never means approval or guaranteed funding.
- A family request log is a local record. It does not contact, authenticate, vet, or qualify a helper. Completion stays unconfirmed until explicitly recorded as a family report.
- No private photos, addresses, secrets, tokens, or sensitive household data in fixtures, browser storage, recordings, or Git. Everything in `public/` is publicly served.
- Storage must use `fixlist:demo:v1`, validate its schema, recover from errors, and provide reset without clearing unrelated browser data.
- Print must use native browser printing and a checked print stylesheet. A build does not prove usable printed output.
- No commits, branch promotion, PR, deployment, external send, or upload without authorization. Preserve concurrent owner files.

## Definition of done

For the local journey: exact install and lockfile, strict typecheck/build, meaningful domain/storage tests, confirmation and uncertainty invariants, recoverable persistence/reset, native print output, typed synthetic fixtures, current architecture and recording roadmap, and actual assistance recorded. Runtime preview, keyboard/narrow layout and print inspection remain separate required checks when relevant behavior changes; do not replace them with a passing build.

Before recording: implement and exercise the selected journey, meaningful rules tests, source/provenance disclosures, keyboard access and readable responsive states, storage recovery/reset, and print preview. No performance claims without measurements. Keep the initial JavaScript budget at 250 KiB gzip and review Vite build output when dependencies change; this is a budget, not a measured user-latency claim.

Before submission: record significant student technical contributions and understanding, disclose tools and AI assistance, and satisfy the current CAC rules. No fabricated authorship, validation, sources, outcomes, or completed work.
