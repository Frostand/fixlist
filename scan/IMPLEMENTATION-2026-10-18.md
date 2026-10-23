# Suggestions v2 and evaluation implementation plan

Goal: implement the binding `docs/suggestions-v2-contract.md` within `scan/`, preserving legacy imports and all existing private outputs.

Architecture: share the existing review request, image encoder and loopback client. Keep schema validation independent of model libraries; separate numerical evaluation from dataset/CLI orchestration. No model fine-tuning or server startup.

- [x] Update `suggestion_schema.py` to validate v1/v2 and recompute summaries, calibration and relevance decisions. Update `suggest.py` to score frames first, select relevant maxima, localize only selected frames, and load optional adopted calibration. Regressions: irrelevant global maximum, contradictory summaries, v1 without viewpoint, synthetic COLMAP v2 with calibration.
- [x] Fix catalog original prompts against read-only `demo-scenario.ts`; construct runtime serve hints from environment defaults; move test guards after every test class. Run `scan/venv-python -m unittest scan/tests/test_suggest.py`.
- [x] Add numerical calibration/evaluation helpers and `evaluate_model.py`: validated resumable JSONL scoring, group holdout and CV, constrained Platt fitting, raw/calibrated metrics and grouped bootstrap CIs, evidence-gated adoption. Test exact tiny-array metrics, group separation, known synthetic parameters, adoption and resume behavior.
- [x] Document the v2 schema and pre-registered protocol in `SUGGESTIONS.md`, preserving dated historical reports and the real MLX section. Run full discovery with zero skips and direct suggestion execution; if reachable, score three temporary copied frames on the existing server. Inspect the final diff and report exact evidence to the parent; do not commit.

Acceptance: all schema derivations follow the contract; no non-relevant localization; unadopted calibration requires explicit force; untouched held-out groups are never used for fit/selection; no writes outside `scan/` except automatically cleaned temporary test data; no private real scan output changes.


Final execution evidence (2026-10-18):

- `scan/venv-python -m unittest discover -s scan/tests`: 92 tests, OK, zero skips (4.327 s). Temporary console log: `/tmp/fixlist-scan-tests-2026-10-18.log`.
- `scan/venv-python -m unittest scan/tests/test_suggest.py`: 38 tests, OK (1.631 s).
- `scan/venv-python scan/tests/test_suggest.py -v`: 38 tests, OK; CameraViewpointTests explicitly listed (1.620 s). Log: `/tmp/fixlist-suggest-direct-2026-10-18.log`.
- `scan/venv-python -m unittest discover -s scan/tests -p test_evaluate_model.py -v`: 16 tests, OK (1.378 s); final full discovery also covers the trailing-line recovery addition.
- `git diff --check -- scan`: clean. Both Python CLI `--help` commands exit 0.
- Read-only validation accepted the real v1 viennese-v2 output and an in-memory copy without viewpoint. Real file SHA-256 stayed `465e8b018c3a9f163ad59bdeda5469ca864065ebd73ad597655e78c92477906c`.
- Existing server probe: `socket.create_connection(('127.0.0.1', 8090), timeout=1)` failed with `ConnectionRefusedError: [Errno 61] Connection refused`. No server startup, live scoring, or actual labeled-data calibration was performed. No real scan output was replaced.

Protocol conventions: ceil 30% holdout, at least five dev groups, Brier selection with 1e-12 simpler-method ties, fixed L2=1, average precision AUPRC, irrelevant human labels negative even with null condition, undefined metrics reported as null with defined bootstrap counts. Calibration example counts are distinct labeled photos; report metric n and extra counters preserve image-item label denominators. These decisions are recorded in SUGGESTIONS.md and every fit output.

Review note: the positive-slope constrained Newton update solves the intercept on the boundary; naive slope clipping failed an anti-correlated-score diagnostic and is covered by a regression. Atomic score appends use a lock, one O_APPEND write, fsync and rollback on recoverable write failure; crash-truncated tails require explicit recovery and are rejected on resume.

Only scan/ files were edited by this worker. Concurrent owner/app changes were preserved. No commits, new dependencies, uploads, or deletions from private-captures/.
