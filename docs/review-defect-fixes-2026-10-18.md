# Review defect fixes — implementation handoff, 2026-10-18

Implemented on `codex/fixlist-core-2026-10-17` using GPT-6.1 Sol at xhigh in T3 Code. Parent review remains required. No commit, native sync, upload or external action was performed. `private-captures/`, `ios/`, dependency versions, lockfile and the existing untracked `.claude/` directory were not modified.

## Changes and design

### P1: Request history cannot block revocation or exit

Ordinary changes still stop at 120 request events. A separate seven-entry reserve permits all five sharing-field revocations, assignment cancellation/withdrawal, then final cancellation of the resulting draft. Decline and final resident completion can also use the reserve. Privacy-only sharing changes can use it when they disable at least one field and enable none. No events are trimmed or compacted.

Storage accepts up to 127 events (revision up to 128 for migrated requests, whose original creation is represented separately). It also enforces `history.length + remainingPrivacyEvents(request) <= 127`, so loaded state cannot consume capacity needed for future privacy reductions and closure. The existing schema version and storage key remain unchanged. Identical proposals, sharing settings, revocations and consecutive progress updates return the same state without incrementing revisions or appending history.

Regression coverage includes all four requested commands at 120, loss of volunteer access, every field revocation followed by assignment/final cancellation through event 127, actual save/load round-trips, no-ops, ordinary capacity enforcement, and rejection of saved states without sufficient reserve. Decline, final completion and privacy-only sharing changes at the limit are also covered.

### P1: Generated iOS assets stay behind the private file boundary

The existing early middleware now refuses decoded `ios` path segments, including slash/backslash separators and case variants, in addition to `private-captures`. Repeated decoding and malformed-escape handling remain in that same guard. It runs before static serving and `/@fs/` in both dev and preview. `server.fs.deny` also contains `**/ios/**`. The `/local-scans/` allowlist remains the route for local scan access. The bundling script has a comment documenting this boundary; its copy behavior is unchanged.

Synthetic tests create only temporary scan/native-asset trees. They cover direct, absolute, encoded, multiply encoded, malformed-escape and cross-site requests, while checking that the local index and allowlisted files still work. No real private bundle contents were read for these tests.

### P2: Apply calibration only to its scoring model and conditions

Fit files retain the scoring model name and now record `scoringConditions` with `thinkMode`, `imageMaxEdge` and `requestSignature`. Scoring and suggestion generation share the signature implementation; it hashes the review request and the 1024-pixel image limit. Fit conditions are recovered from validated score signatures, rather than guessed from fit defaults.

`suggest.py` validates conditions before inference, then checks the calibration model against each actual model response before applying a mapping. A mismatch, including one first discoverable from a model response, fails without writing output and preserves any prior output. `--force-calibration` overrides adoption only. `--no-calibration` bypasses the fit file and continues with raw scores.

The suggestions v2 `calibration` block is unchanged; no TypeScript importer/schema change is needed. Older score signatures do not bind preprocessing and are rejected: rescore in a separate dataset before fitting. Older fit files lacking provenance must be replaced or bypassed with `--no-calibration`. Matching runs, mismatched models/think modes/image limits/signatures, missing provenance, output preservation and signature sensitivity have regression coverage. A real fit CLI is exercised with synthetic scores.

## Required validation

All commands passed under Node 24.18.0 / npm 11.16.0:

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | 969 passed across 26 files; no failures or skips |
| `npm run build` | Passed |
| `scan/venv-python -m unittest discover -s scan/tests` | 98 passed; no failures or skips |
| `git diff --check` | Passed |

The build reports main JavaScript at 151.02 kB gzip, below the 250 KiB initial budget. Vite emits a large-chunk warning for the lazy scan-viewer chunk (1,036.47 kB gzip). No performance improvement is claimed. No Simulator run or native build was performed for this scoped fix.

## Live dev-server curl results

Started a real `npm run dev` on `127.0.0.1:5173`. Ran `curl --path-as-is --silent --show-error --max-time 10 -o /dev/null -w '%{http_code}'` against each path below. The cross-site runs additionally sent `Origin: https://external.example` and `Sec-Fetch-Site: cross-site`.

| Path | Ordinary request | Cross-site request |
| --- | --- | --- |
| `/ios/App/App/public/local-scans/viennese-v2/scene.json` | 404 | 404 |
| `/@fs/Users/al1234/.t3-custom/projects/fixlist/ios/App/App/public/local-scans/viennese-v2/scene.json` | 404 | 404 |
| `/%2569os%252fApp%252fApp%252fpublic/local-scans/viennese-v2/scene.json` | 404 | 404 |
| `/@fs/Users/al1234/.t3-custom/projects/fixlist/%69os/App/App/public/local-scans/viennese-v2/scene.json` | 404 | 404 |
| `/ios/App/App/public/local-scans/viennese-v2/scene.splat` | 404 | 404 |
| `/local-scans/index.json` | 200 | Not requested in this live check |

Stopped that dev server afterwards and verified no listener remained on port 5173. Port 4173 was left alone; its existing Node listener (PID 22732) remained running.

## Files changed

- Request history: `src/domain/roles.ts`, `src/domain/workflow.ts`, `src/lib/state-validation.ts`, new `src/domain/request-history.test.ts`.
- Private boundary: `vite.config.ts`, `src/lib/local-scans-server.test.ts`, `scripts/ios-demo-scan.mjs` (comment only).
- Calibration: `scan/suggest.py`, `scan/evaluate_model.py`, `scan/suggestion_schema.py`, `scan/tests/test_suggest.py`, `scan/tests/test_evaluate_model.py`.
- Documentation: `docs/architecture.md`, `scan/SUGGESTIONS.md`, this report.

## Review gate outcome (2026-10-18)

GPT-6 Astra reviewed everything after `ab48023` in five read-only rounds. Each round re-ran typecheck, tests and build.

| Round | Reviewed | Confirmed findings | Fixed in |
| --- | --- | --- | --- |
| 1 | `ab48023..39930a2` | History limit could block revocation (P1); bundled iOS scans served by Vite (P1); calibration applied across models (P2) | `a81247b` |
| 2 | `a81247b` | Symlink aliases bypassed path guards (P1); scan named `ios` unloadable (P2) | `70c410f` |
| 3 | `70c410f` | HTML-fallback symlink bypass (P1); raw `#` target in preview (P2) | `3281c51` (allowlist) |
| 4 | `3281c51` | Preview served a build-copied public symlink (P1); allowlist blanked the dev app (P1) | `1b05ec5` |
| 5 | `1b05ec5` | None. **Accepted.** The real dev app fetched 87 resources, all 200; the copied-asset build now fails | — |

TOCTOU races, and attackers who can already write into `src/` or `node_modules/`, were judged out of scope for this loopback-only developer server. The iOS app does not use the Vite server.
