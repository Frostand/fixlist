# FixList working instructions

## Objective and scope

Build one small local browser demo that can support an honest 1–3 minute video. The current task is a scaffold, not the full product. Read `docs/architecture.md` before changing scope and `docs/video-shot-list.md` before implementing a recording flow. Preserve the existing `assets/icon.svg` and the body of `fixlist-plan.md`.

## Model routing

Follow Andrew's current global agreement in `/Users/al1234/.codex/AGENTS.md`. The callable collaboration tooling for this setup supports `gpt-6-astra` at `xhigh` for evidence-based decisions and final acceptance, `gpt-6.1-sol` at `xhigh` for substantive implementation, and `gpt-6-luna` at `xhigh` for narrowly bounded work. Select and verify supported routing controls; this file does not switch the running model or reasoning level.

The global roles also specify `claude-opus-5-5` at `xhigh` for open-ended alternatives and `claude-sonnet-5-5` at `high` for communication. Those Claude models are unavailable through this session's callable routing tools. Report a required-role blocker and use only an existing authorized handoff when available. Do not silently substitute, install routing tools, or create new chats. Bounded technical setup may continue where it does not depend on an unavailable role.

Delegate only concrete independent work that benefits from it; do not spawn a worker just to run a command. Use no more than three concurrent spawned workers. An Astra reviewer must inspect delegated changes and deterministic evidence before acceptance; a completion message is not acceptance evidence.

## Architecture and commands

- One React/TypeScript/Vite ESM project; plain CSS; Vitest for later meaningful domain tests.
- `src/app`: app composition and, later, the recorded journey.
- `src/domain`: types and, later, pure confirmation/plan/screening logic.
- `src/data`: synthetic fixtures and, later, separately sourced program records.
- `src/lib`: later browser storage and print integration; no placeholder services.
- `public/demo`: assets safe to publish, with documented provenance.
- `docs`: architecture, video requirements, assistance disclosures, and implementation plans.
- `recordings`: ignored local exports; keep its README tracked.

Use Node 24.18.0 and npm 11. Run `npm ci`, then `npm run dev` (127.0.0.1:5173). Required checks: `npm run typecheck`, `npm run build`, and `npm test`. `npm run preview` serves the built app at 127.0.0.1:4173. `npm test` currently uses temporary `--passWithNoTests`; do not describe an empty suite as passing behavioral coverage. Remove that flag when real tests arrive.

## Constraints

- Keep exact direct dependency versions and the npm lockfile. Add dependencies only for demonstrated needs. No backend, authentication, database, GPU, native capture, reconstruction, 3D, email, analytics, or external service in this demo scope.
- Evidence and human confirmation are separate. Only confirmed concerns may enter a future computed plan. The app does not certify a home as safe or provide a complete assessment.
- Fictional programs must say they are fictional, use synthetic source status, and have no invented verification date. Missing answers remain `unknown`; criteria matching never means approval or guaranteed funding.
- A family request log is a local record. It does not contact, authenticate, vet, or qualify a helper. Completion stays unconfirmed until explicitly recorded as a family report.
- No private photos, addresses, secrets, tokens, or sensitive household data in fixtures, browser storage, recordings, or Git. Everything in `public/` is publicly served.
- Later storage must use `fixlist:demo:v1`, validate its schema, recover from errors, and provide reset without clearing unrelated browser data.
- Later print must use native browser printing and a checked print stylesheet. A build does not prove usable printed output.
- No commits, branch promotion, PR, deployment, external send, or upload without authorization. Preserve concurrent owner files.

## Definition of done

For the scaffold: exact install and lockfile, strict typecheck/build, honest test status, minimal semantic status page, typed synthetic fixtures with no broken media paths, current architecture and recording roadmap, and actual assistance recorded. Runtime preview inspection is a separate required check; report if it has not happened.

Before recording: implement and exercise the selected journey, meaningful rules tests, source/provenance disclosures, keyboard access and readable responsive states, storage recovery/reset, and print preview. No performance claims without measurements. Keep the initial JavaScript budget at 250 KiB gzip and review Vite build output when dependencies change; this is a budget, not a measured user-latency claim.

Before submission: record significant student technical contributions and understanding, disclose tools and AI assistance, and satisfy the current CAC rules. No fabricated authorship, validation, sources, outcomes, or completed work.
