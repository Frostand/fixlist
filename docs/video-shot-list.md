# Demo video implementation and shot list

The synthetic software journey is implemented and rehearsed; this is the recording plan, not a completed student submission or a recorded video. Target approximately two minutes, within the CAC rules' 1–3 minute public-video requirement. Confirm final requirements against the [2026 official rules](https://www.congressionalappchallenge.us/wp-content/uploads/2026/05/2026-CAC-Rules.pdf).

| Time | Screen / action | Evidence needed before filming | Honest narration boundary |
| --- | --- | --- | --- |
| 0:00–0:15 | Title and purpose | Participant names, app name, intended audience, accurate one-sentence purpose. | Explain the proposed workflow; make no safety or outcome claim. |
| 0:15–0:35 | Sample room and checklist | Publishable asset provenance or a clearly labeled text scenario; working checklist input. | Say this is a synthetic home. Describe preprocessed annotations as preprocessed; no live detection claim. |
| 0:35–1:00 | Confirm concern, generate plan | Unconfirmed concerns excluded; explicit confirmation changes a plan computed by real rules; explain ordering. | Distinguish supplied example observations from the result computed during the recording. No complete hazard-coverage claim. |
| 1:00–1:25 | Assistance screening | Computed screening from fixed fictional profile facts and nested conditions; source/date for any future real records; visible unknowns. | Fictional records stay labeled fictional. A criteria match is not eligibility, funding, or approval. |
| 1:25–1:45 | Family request log | Working local draft/status update, family attribution, unconfirmed completion until explicitly reported. | Say “recorded locally.” No invitation sent, vetted helper, independently verified repair, or guaranteed response. |
| 1:45–2:00 | Print preview and closing | Usable print output, uncertainty/source labels, actual languages/tools and assistance disclosure. | Identify React/TypeScript/Vite and actual AI use. State remaining demo limits and student contributions accurately. |

The screens above now exist. See `validation-facts-catalog-2026-10-17.md` for current checks and `validation-2026-10-17.md` for earlier core evidence. Keep the final footage focused on a single repeatable journey; use one or two of the eight sample concerns; 3D, native capture, authentication and outreach remain outside this recording scope.

## 3D scan and AI suggestion segment (optional, about 40 seconds)

Use this in place of part of the 0:15–1:00 window when showing the scan. Load it with `http://127.0.0.1:4173/?localScan=viennese-v2#scan-heading` (dev/preview server only).

| Screen / action | Evidence needed before filming | Honest narration boundary |
| --- | --- | --- |
| Short clip of the walkthrough video, then the 3D scan orbiting | Footage source and license on screen or in credits: UE4Arch "Viennese apartment", Wikimedia Commons, CC BY-SA 4.0 (a photoreal render, not a real home). Pipeline ran locally on the Mac. | "We turned a walk-through video into a 3D model on this laptop." Do not call it a measurement or a scan of a real house; units are arbitrary. |
| Model suggestions list, then **Show in 3D** | StartLux-Decision v1.1 9B (MLX, CC BY-NC 4.0 weights) credited; probabilities come from the recorded `suggestions.json`. | "A local AI model estimates which checklist items might need a look, and shows the frame it looked at." It is a suggestion, not hazard detection, and it can be wrong. |
| Dismiss the hanging-lamp "cord" suggestion; pin the rug yourself | Show that dismissing and pinning are explicit family actions. | "The family decides." Never imply the model confirmed anything; the pin turns yellow only after explicit confirmation. |

## Recording gate

- Preserve the implemented journey and meaningful rules/storage tests; rerun typecheck, build and tests after relevant changes.
- Verify that reset restores a clean synthetic starting state and the sequence repeats without manual data editing.
- Check browser console errors, keyboard operation, readable narrow/wide layouts, and actual print preview/PDF.
- Record which data is synthetic, which assets were preprocessed, which values are computed live, and which statuses are family-reported.
- Verify real program claims against primary sources or retain disclosed fictional examples; do not invent sources or verification dates.
- Record actual student technical contributions and AI/tool assistance. Have the student explain the confirmation, plan, screening, storage, and print code being shown.

## Repeatable two-minute rehearsal

Reset, answer yes for the rug, and pause to show the empty plan before separate confirmation. Confirm, then jump to Action plan and show its explanation. Jump to Help programs: all facts start unknown. Select the fictional Maple renter to show the failed support ownership condition and the matched lighting residency alternative. Point out that lighting work categories do not overlap a rug-only plan. Select the incomplete Maple profile to show missing facts without approval claims. Create a local rug request, record requested, and show that completion remains unconfirmed until its separate button is used. Inspect/print the report and close with the actual assistance disclosure. Avoid claiming a real application or contact was sent.

Before filming, Andrew must choose and complete a meaningful technical contribution and be able to explain the relevant implementation. The AI-generated implementation and this rehearsal do not establish student authorship. No final video has been recorded or uploaded.

Keep raw captures and local exports out of Git. Use [`recordings/README.md`](../recordings/README.md) for file handling. Do not upload or publish without explicit authorization.
