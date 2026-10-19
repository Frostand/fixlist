# Product direction and validation gates

Decision date: October 17, 2026. This is a testable product proposal and an engineering validation plan, not evidence of user benefit, clinical effectiveness, or novelty.

## Chosen direction

FixList helps a family keep track of **what was observed, what they explicitly confirmed, what to review next, what assistance information is missing, and what they have only reported as completed**. The first useful technical contribution is keeping those states distinct throughout editing, saving, reloading, printing, and undoing confirmation.

The current build uses two fictional observations and a fictional program. It tests the workflow without collecting household details. The action order is an authored demonstration review order, not a medically validated ranking. Real action guidance needs an appropriate source and review before replacing the synthetic examples.

The primary user hypothesis is a family coordinator who already knows about a possible home concern but has to carry context between a checklist, assistance pages, and a family task list. The beneficiary and need are plausible; no interview, partnership, adoption, or outcome has yet established them.

More specifically, design for an adult child or grandchild operating the workflow with the older resident's participation. The resident also needs a readable report. Volunteer and agency-intake audiences remain future hypotheses. The [larger-plan integration review](plan-integration-review.md) records what is retained, corrected and deferred, including the next fact-based screening and structured-catalog milestones. This preserves the same-information worksheet as the baseline and does not expand the current app into a marketplace or assessment service.

## Closest alternatives checked

| Alternative | Evidence checked October 17, 2026 | Consequence for FixList |
| --- | --- | --- |
| AARP HomeFit AR | The developer's [App Store description](https://apps.apple.com/us/app/homefit-ar/id1513619492) describes camera scanning, recognizing room elements/appliances, and suggestions for improvements. This is a description, not an independent effectiveness evaluation. | Room scanning and suggested fixes are established product territory. Do not claim them as FixList's invention. |
| AARP HomeFit worksheets | AARP's [worksheet collection](https://www.aarp.org/livable-communities/housing/info-2020/homefit-worksheets.html) includes room-by-room to-do, supply, DIY, and non-DIY lists. | A paper checklist with organized next steps is a credible low-complexity baseline. A digital version must add observable workflow value. |
| SafeHavenAI | [Rep. Buchanan's announcement](https://buchanan.house.gov/2024/12/16/id-37ebb465-e165-43f7-affa-e43fd7daff7c/) describes uploaded photos, image recognition, and questions for screening possible home fall risks. The [CAC winner page](https://www.congressionalappchallenge.us/24-fl16/) confirms it was a 2024 winning entry. | Photo assessment is also a close CAC precedent. Those pages do not establish clinical efficacy, and FixList should not repeat their stronger outcome claims. |
| RASSAR | The authors' [2024 research paper](https://arxiv.org/abs/2404.07479) studies room accessibility/safety scanning in augmented reality. | Automatic room assessment is already an active research area. A 3D branch would require its own close-precedent and accuracy study. |

This bounded review supports avoiding a generic “AI home safety scanner” pitch. It does **not** prove that the combined FixList workflow is unique. The proposed distinction is an explicit, inspectable chain from confirmation to follow-through, with uncertainty that survives every output.

## Architecture decision

Keep the core in pure TypeScript with deterministic commands and derived read models. Store the smallest editable synthetic state, then reconstruct labels, evidence, and program descriptions from trusted fixtures. Never persist a computed plan or a cached screening result as authoritative: it would become stale after an answer changed.

Use React only for controls and presentation, a storage adapter for the browser boundary, and native printing for the handoff. This makes the difficult invariants testable without a browser or server. Hardcoded fixtures are legitimate inputs; the plan, screening, request transitions, and persistence behavior must be genuinely computed.

The local browser build has no authentication, concurrency control between people, server authorization, verified identity, or private-media protection. A future server would make command handling and ownership checks authoritative at its boundary and add explicit retention/consent requirements. The present command interface is a useful seam, not proof that those production requirements are solved. Do not build a server merely to rename local functions “backend.”

## Riskiest assumptions

| Assumption | First test | Continue / pivot / stop |
| --- | --- | --- |
| The workflow prevents accidental certainty | Automated transition tests plus adversarial browser cases: yes without confirmation, answer reversal, unanswered criterion, failure plus unknown, report completion then retract concern. | Continue only if each output preserves the distinction; any false confirmation/match/verified-repair statement blocks filming until fixed. |
| A saved state can be trusted to preserve these rules | Reject malformed, stale-version, unknown-ID, oversized and internally inconsistent data; simulate denied reads/writes/deletes and reload. | Continue with truthful in-memory fallback. Do not show “saved” if storage failed; never silently load unknown content. |
| Families understand the distinctions | Small comparison below, using synthetic examples and no real private data. | Reword or simplify if someone mistakes criteria matching for approval, a local log for outreach, or a family report for independent verification. |
| Integration is more useful than separate documents | Same-information baseline, counterbalanced tasks, descriptive time/error counts. | Continue if understanding stays intact and task completion improves; pivot to a narrower checklist/print tool if integration adds work without useful clarity. |
| Real assistance can be represented responsibly | Select one county with Andrew, verify one actual program directly with its administrator's published criteria/contact/source date, expose unmodeled criteria. | Keep fictional records until this succeeds. No invented geographic applicability, approval date, availability, or funding guarantee. |

## Small user comparison to run after Andrew reviews the code

Recruit 3–5 willing adults/family coordinators only after Andrew authorizes arranging it. No messages have been sent and no participants have been recruited. Use synthetic rooms and fictional program criteria. Participation is optional; collect anonymous task notes, not household or medical details.

Compare FixList against a plain worksheet containing exactly the same observations, action text, fictional criteria, and local request statuses. Use two equivalent scripted examples; alternate which tool and example comes first. Avoid comparing a richly populated app to an impoverished blank document.

Give each participant four tasks: select one concern for review while leaving another unconfirmed; identify a missing program fact without declaring approval; record requested/in-progress/completion as local family reports; reverse an answer and explain what changed. Before helping, ask them to state the next action, missing information, and whether anyone was contacted.

Record denominator and raw counts for task completion, assistance needed, state misinterpretations, and missing-information errors. Time each task in seconds, and keep observation notes separate from interpretation. With 3–5 convenience participants, report descriptive paired results only; no population effect, significance, fall reduction, or clinical benefit claim is justified.

Proposed pilot gate: every participant must correctly distinguish approval/contact/verification after the walkthrough; at least 80% (round up: all 3, all 4, or 4 of 5 participants) should complete the core sequence without intervention. A 20% lower median completion time is an exploratory improvement target, useful only if errors do not increase. These thresholds are engineering decisions, not validated clinical standards. If uncertainty labels fail, fix comprehension first. If completion/time adds no value over the worksheet, narrow the product before adding features.

## Software acceptance versus real-world validation

Tests can establish behavior for the tested synthetic inputs, while browser checks establish the exercised rendering and interactions. Neither establishes professional action advice, complete hazard detection, real-program applicability, trusted helpers, completed repairs, usability for older adults, or improved outcomes. The validation report must state which checks actually ran and which remain open.

## Submission boundary

The [official 2026 CAC rules](https://www.congressionalappchallenge.us/wp-content/uploads/2026/05/2026-CAC-Rules.pdf), rechecked October 17, allow disclosed AI support but require significant student contributions and technical understanding; AI must not constitute the entire technical development. This overnight AI-assisted build is a working reference for review, extension, and explanation. It does not establish Andrew's authorship or satisfy the student-contribution requirement by itself. Keep an actual contribution record, not a fabricated retrospective.
