# FixList: scoped build plan, zero to submitted

> **Current demo scope (October 15, 2026):** [docs/architecture.md](docs/architecture.md) supersedes this document's production stack and implementation sequence for the video-focused demo. This original plan is preserved as background; its backend, authentication, database, native/GPU reconstruction, and optional 3D systems are not part of the current scaffold.

Congressional App Challenge 2026. Written and revised October 15; submit October 25. The [official rules PDF](https://www.congressionalappchallenge.us/wp-content/uploads/2026/05/2026-CAC-Rules.pdf) lists October 26 at 12:00 pm EDT, while the [registration page](https://www.congressionalappchallenge.us/students/student-registration/) lists 9:00 pm ET. Keep the earlier deadline as the planning limit and the October 25 internal submission target.

One sentence: FixList helps families document home hazards, turn confirmed concerns into a prioritized repair plan, find potentially relevant assistance programs, and coordinate follow-through with known helpers.

This document separates the submission commitment from optional prototypes and work after submission. As of October 15, this workspace contains a README and icon; the architecture, timings, safety controls, and performance below are requirements or hypotheses, not demonstrated implementation. Read sections 1 to 3 first; use section 10 as the build sequence.

---

## 1. Ground rules

### 1.1 Contest rules that bind the build

- Eligible: any app built after October 30, 2025. A 2.0 of an earlier app is allowed, and judges weigh only the new code.
- Originality: the rules require original work with significant student/team technical contributions and documented external tools/libraries. For ChoreMap reuse, inventory code provenance, contributors, and rights; do not present former teammates' work as entrant-authored. Filtering commit authors alone does not establish authorship or ownership. Exclude or rebuild material whose reuse cannot be established under the rules, and seek organizer guidance for unresolved cases before submission. Explain the actual project lineage in the inspiration answer.
- Teams: up to four. At least half must live or attend school in the submitting district. One entry per person per year.
- Open-source libraries, frameworks, and external tools are allowed if clearly documented. AI tools are allowed if fully disclosed and not the entirety of the technical work.
- Judging criteria: quality of idea (creativity, originality); implementation (UX, design); demonstrated excellence of coding. Judges may request the source and a working app; refusing is disqualification.
- Submission: a 1 to 3 minute public video (YouTube or Vimeo) stating each participant's name, the app name, a one-sentence purpose, the audience, the tools and languages, and showing it working; plus written answers (title, purpose, inspiration, hardest technical problem, what you learned, 2.0 plans).

### 1.2 Product rules we set for ourselves

- Only human-confirmed concerns enter the repair plan through a deterministic checklist engine. A completed checklist is not proof that every hazard has been found or that the home is safe.
- Every program match shows a citation, verified date, matched criteria, unanswered criteria, and a contact. A match is not final eligibility, funding approval, or a guaranteed payer.
- Nothing about a home is shown to a volunteer until the senior or family member approves it.
- Helper requests are invitation-only and limited to a person or organization already known to the family. Inside-the-home requests need two helpers and either verified organization membership or a family member present. These controls do not establish vetting or trade qualifications.
- The core journey works with ordinary photos. Optional 3D must pass the prototype gate within 24 to 48 hours of starting it, no later than October 17 evening; otherwise stop that work for this submission.
- Capture speed, hazard coverage, reconstruction time, dimensional accuracy, and outcomes are reported only when measured. Do not promise a one-minute assessment, complete hazard detection, or fewer falls.

### 1.3 Submission scope

Commit to a responsive web app with a guided checklist, room photos or photo pins, explicit confirmation, a prioritized plan and PDF, three to five verified assistance programs for one county, and a small invitation-only helper request/completion flow. If fewer programs actually apply locally, publish fewer rather than filling a quota.

The only optional submission addition is one reliable 3D capture/viewer path with persistent pins, if section 4's early gate passes without delaying the core journey. Use tape-entered dimensions in the submission. Defer vision pre-fill, scored volunteer matching, public volunteer recruitment, orbit-video rendering, automatic clearance judgments, and broad geographic coverage.

---

## 2. Problem, audience, and the "why not X" answers

### 2.1 Problem

Falls are a major source of injury for older adults. Use [CDC older-adult fall statistics](https://www.cdc.gov/falls/data-research/facts-stats/index.html) for the final presentation, with the population, measure, and year stated. Do not infer that every fall has a visible household cause or that every repair is inexpensive. The app focuses on documented environmental concerns such as loose rugs, cords across walkways, missing supports, and poor lighting.

Potential assistance includes USDA Section 504, local aging-agency services, some Medicaid waivers, nonprofit repair programs, veteran benefits, and some Medicare Advantage supplemental benefits. Availability, covered work, service areas, application status, and eligibility differ; these are candidates to verify, not promised funding. Do not claim that funding goes unused without evidence. [USDA's Section 504 page](https://www.rd.usda.gov/programs-services/single-family-housing-programs/single-family-housing-repair-loans-grants) currently lists a $10,000 lifetime grant limit and criteria including homeownership and occupancy, county income limits, eligible rural location, inability to obtain affordable credit elsewhere, and age 62 or older for grants. The administrator makes the final determination.

### 2.2 Audience

Primary: adult children and grandchildren of an older person living at home, who hold the phone. Secondary: the older person themselves, volunteers (students, neighbors, service clubs, congregations), and the Area Agency on Aging intake worker who receives the plan.

### 2.3 Closest alternatives and proposed distinction

- [AARP HomeFit AR](https://apps.apple.com/us/app/homefit-ar/id1513619492) already uses room scanning, image recognition, and AR to suggest improvements and provide an assessment checklist distinguishing DIY tasks from professional work. HomeFit is not limited to PDFs.
- [SafeHavenAI, a 2024 CAC winner](https://buchanan.house.gov/2024/12/16/id-37ebb465-e165-43f7-affa-e43fd7daff7c/), uses uploaded photos, image recognition, and questions to screen fall risks within homes. It is direct prior work for home assessment, not merely screening the person.
- [Volunteers for Seniors, another 2024 CAC winner](https://www.congressionalappchallenge.us/24-FL27/), is adjacent prior work for helping older adults through volunteer support. Benefits directories and home-capture tools are also relevant comparison categories; do not make universal claims about features they lack without checking.

FixList's proposed distinction is the traceable connection from a documented concern to an explained action, locally verified assistance, and recorded follow-through. Room scanning or AI hazard identification alone is not the novelty claim. The combined workflow's uniqueness and usefulness remain unverified.

### 2.4 Bounded validation before the video

Compare the proposed workflow with a checklist, annotated photos, and separate assistance links. Ask three to five family members or likely helpers to explain the next action, the funding unknowns, and the information they would need before helping. Record task completion, time, confusion, and the number of participants; do not present this convenience sample as proof of clinical benefit. If optional 3D passes its technical gate, check whether it helps users understand a task better than annotated photos. Keep it only if its observed value justifies the remaining integration work. If the combined workflow adds little value, narrow the claims to the useful parts rather than claiming a new category.

---

## 3. Architecture

### 3.1 Components

1. Web app (Vite, React, TypeScript): room photos and photo pins, checklist confirmation, tape-entered dimensions, repair plan, assistance explanations, PDF, and invited-helper requests.
2. API (FastAPI, SQLite): homes, photos, concerns, plans, program screening, invitation-only requests, sessions, consent, and deletion. Access control applies to media files as well as JSON.
3. Engines (Python packages, pure functions): confirmed-concern rules, three-valued program screening, and helper-request constraints. No matching scorer in the submission.
4. Optional capture app (iOS, Swift, ARKit): a time-boxed keyframe/pose export prototype. Do not require it to use the core app.
5. Optional reconstruction worker and viewer (Docker, CUDA, OpenSplat, three.js): a single proven path with persistent pins, admitted only through section 4's gate.
6. After submission: vision proposals, scored matching, and additional capture/fallback pipelines.

### 3.2 Data flow

Core: take or upload room photos, answer checklist questions, confirm concerns, optionally enter tape measurements, generate a prioritized plan, review potential programs with criteria and unknowns, export the PDF, invite a known helper to an eligible request, record acceptance/completion, and obtain family confirmation. Optional 3D supplies another location view; it does not change the confirmation or program-screening rules.

### 3.3 Repository layout

```
fixlist/
  ios/FixListCapture/        optional: ARKit prototype, only after scope gate
  worker/                    optional: OpenSplat wrapper and metrics
  api/                       FastAPI, auth, photos, plans, requests, consent
  engines/
    hazards/                 taxonomy.json, engine.py, tests/
    eligibility/             programs/<state>/<county>.json, engine.py, tests/
    requests/                invitation and work-category rules, tests/
  web/                       checklist, photo pins, plan, assistance, requests
  data/samples/              consented/redacted photo fixtures; optional 3D fixture
  docs/                      README, DISCLOSURES.md, PRIVACY.md, VIDEO_SCRIPT.md
  docker-compose.yml
```

### 3.4 Hardware budget

The core app must run without a GPU. If optional 3D is admitted, the RTX 3070 has an 8 GB budget: use one training job at a time, downscale 2 (or 4), capped iterations and Gaussian count, and subsampled frames. Record peak VRAM and elapsed time on the actual machine; these are measurements to collect, not promised performance. A future vision worker would share the same GPU lock and never run concurrently with training.

---

## 4. Optional prototype: 3D capture and reconstruction

This section is conditional, not a dependency of the submission. Protect the photo-based core and follow the early gate in section 4.4.

### 4.1 Capture (Swift, ARKit)

Goal: demonstrate that a real ARKit bundle can be consumed by the pinned OpenSplat version without a separate structure-from-motion step. Metric pose units do not establish accurate reconstructed dimensions.

- Session: ARWorldTrackingConfiguration, no LiDAR required. ARKit's visual-inertial odometry gives metric camera poses.
- Keyframe rule: save a frame when the camera has moved more than 0.3 m or rotated more than 15 degrees since the last keyframe, tracking state is normal, and the frame is sharp (variance of Laplacian over a downscaled gray image above a threshold you tune on your own living room).
- Per keyframe store: JPEG (downscaled to a max dimension of 1280 to keep uploads and VRAM sane), the 4x4 camera-to-world transform, intrinsics (fx, fy, cx, cy scaled to the saved resolution), timestamp.
- Seed cloud: accumulate ARFrame raw feature points in the same world coordinates as the camera poses. Export a nonempty PLY with finite XYZ and RGB values. Choose a frame in which each point projects inside the image and in front of the camera when sampling color; validate its alignment with the poses.
- Axis convention: ARKit and Nerfstudio use compatible camera axes (+X right, +Y up, looking down -Z). Still test matrix row/column serialization, image orientation, pose/seed alignment, and intrinsics together. Match each saved JPEG's actual orientation and resolution; do not assume an axis convention alone makes the export correct. [Apple transform reference](https://developer.apple.com/documentation/arkit/arcamera/transform), [Nerfstudio data conventions](https://docs.nerf.studio/quickstart/data_conventions.html).
- Export: `transforms.json` must include top-level `camera_model: "OPENCV"`, `ply_file_path: "sparse_pc.ply"`, and `frames`. Each frame records `file_path`, a 4x4 `transform_matrix`, and intrinsics/resolution matched to its saved image (`fl_x`, `fl_y`, `cx`, `cy`, `w`, `h`). Shared intrinsics are allowed only after verifying they stay constant; zero distortion is a tested assumption, not a default accuracy guarantee. Include `images/`, the referenced `sparse_pc.ply`, and `meta.json` with device, iOS version, frame count, duration, and coordinate units. Start with local bundle transfer; resumable upload is outside the prototype gate.
- Guidance: "walk slowly", "keep the floor in frame", and "do a full loop". A frame count or visited yaw sectors indicate capture progress only, not complete room or hazard coverage. Start with a 60 to 150 keyframe room capture and inspect actual overlap and tracking quality.

Definition of done: a real room bundle passes schema checks, every image and referenced PLY exists, points and transforms are finite, intrinsics match saved images, the pose plot resembles the walk, and projected seed points align with keyframes. It must then pass the actual loader and training smoke in section 4.2; schema validation alone is insufficient.

### 4.2 Reconstruction (worker)

- Pin the OpenSplat commit, CUDA/libtorch versions, and build commands. Confirm supported output formats and exact flags from that binary's help; use PLY for the first smoke rather than assuming optional compression/conversion support.
- Required input: the [current Nerfstudio loader](https://raw.githubusercontent.com/WebODM/OpenSplat/main/nerfstudio.cpp) reads `ply_file_path` and rejects an empty value. The [OpenSplat README](https://github.com/WebODM/OpenSplat/blob/main/README.md) requires sparse points and says random initialization is unsupported. A missing, empty, unreadable, or misaligned seed cloud is a failed input or prototype, not an acceptable random-initialization fallback.
- Job: validate the bundle and seed, run a small actual training smoke, then train the room at downscale 2 or 4 with bounded iterations and Gaussian growth. Save `scene.ply` and `metrics.json` containing commit, command/options, input frame count, elapsed minutes, sampled peak VRAM, Gaussian count, and result. Convert to a viewer format only if the tested viewer needs it.
- If input is invalid, reject it with a specific error. If training exhausts memory or produces unusable geometry, try a smaller bounded job within the original time box. Stop at the gate if it still fails; do not presume that fewer iterations will solve an undiagnosed failure.
- Prototype with one local job; add an API queue only after the whole capture-to-pin path passes. The current documented export preserves input coordinates by default, but verify units and coordinate transforms through viewer conversion. This does not prove geometric accuracy.

Definition of done: one scene from a real capture renders with recognizable room context, a meaningful pin persists after reload, the seed is demonstrably loaded, and metrics are saved on the actual hardware. This admits a location-view prototype only; it does not admit clearance judgments or a dimensional-accuracy claim.

### 4.3 Viewer (web)

- GaussianSplats3D on three.js; load the format proven in the prototype, with basic navigation and a "reset view" button. Do not require a format-conversion pipeline before the first render.
- Pins: picking on splats is unreliable, so pick against a point cloud. Build a downsampled point set from the splat centers (or the seed cloud) at load time, raycast from the click, choose the nearest point within a small radius, store the 3D coordinate with the pin. Pins carry a hazard id, a confirmation state, and an optional photo crop from the nearest keyframe.
- Submission dimensions are entered from a tape measure and labeled with method, date, and units. Do not use splat-center distances for automatic pass/fail judgments. Metric camera poses, visible geometry, and accurate physical-edge picking are separate requirements: one doorway within 10% is insufficient, since 10% of 32 inches is 3.2 inches. Any future scene-measurement feature needs repeated tape comparisons across several dimensions and captures, absolute error reporting, and an uncertainty/re-measure state near a reference target.
- Any 32-inch door or 36-inch pathway reference must identify its source and context. Treat it as a prompt to check a concern, not universal code compliance or a clinical safety boundary. Do not present the app's priority heuristic as a validated fall-risk score.
- On phones or failed WebGL loads, show the existing room photos, pin list, and plan. Benchmark the actual target phone before making performance claims. Orbit-video generation is deferred.

### 4.4 Early prototype gate and one dependable fallback

Decide within 24 to 48 hours of prototype start, no later than October 17 evening. Pass only with an actual capture, valid seeded export, completed training job, usable viewer, persistent location pin, and recorded hardware/time evidence. A stock scene or a schema-only check does not pass. Admit 3D only if integrating it will not delay the core journey; measurement is a separate, deferred gate.

If the gate fails, use ordinary room photos with photo pins and tape-entered dimensions for the submission. Do not start a late RoomPlan, COLMAP, or panorama-stitching rescue project. Those are separate future implementation choices with their own device, calibration, and validation requirements. A failed optional prototype does not block the repair-plan, assistance, or invited-helper flow.

---

## 5. Submission core: confirmed concerns, plan, and assistance

### 5.1 Hazard taxonomy (data, not code)

Source: the CDC STEADI Check for Safety checklist. Cite extensions such as clearance guidance separately; do not attribute every added threshold to STEADI. Start with 10 to 15 reviewed concerns and expand only after the core journey works. Each entry in taxonomy.json:

- id, name, room (floors, stairs, kitchen, bedroom, bathroom, entry and exterior, lighting)
- evidence_method: checklist_answer, photo, tape_measure; future vision proposals remain unconfirmed evidence
- question: the plain-language check ("Is there a rug that slides or curls at the edge?")
- severity: 1 to 3
- fix: one sentence, with an optional product type (non-slip tape, grab bar, night light, rail bracket)
- cost_band: free, under 25, under 100, under 500, over 500
- who: volunteer, volunteer_two_person, pro_electrical, pro_plumbing, pro_carpentry
- funding_tags: grab_bar, railing, lighting, ramp, bathroom_mod, general_repair
- citation: STEADI item reference

Starter concerns: rugs without non-slip backing; cords across walkways; furniture obstructing a route; objects on stairs; broken or uneven steps; poor stair lighting; loose or missing handrails; loose stair carpet; frequently used items on high shelves; no lamp within reach of the bed; poor bed-to-bathroom lighting; slippery tub or shower surface; missing grab bars; concerning thresholds; poor entry lighting. Conditions such as rug backing, loose supports, or actual light availability require a person to check; a photo alone cannot establish them. Narrow openings can be documented with tape measurements and separately sourced guidance, without automatic compliance judgments.

### 5.2 Engine

Pure function: confirmed concerns plus optional tape-entered measurements in, plan items out. Each item carries its source question, evidence method, room/photo pin, confirmation, suggested action, approximate cost band, work category, funding tags, and explanation. Priority is an app-defined ordering heuristic based on the taxonomy and room use, not a clinical risk score. Tests cover confirmation required, traceability, stable ordering, unknown/unanswered questions, unit conversion, and an empty confirmation set. Track checklist completion separately from concern count: zero confirmed concerns can mean incomplete answers or a completed checklist with none recorded; neither means the home is safe.

### 5.3 Vision pre-fill: after submission

Do not select, deploy, or integrate a vision model for this submission. Use explicit checklist answers and human confirmation. If explored later, first benchmark the actual model on the 8 GB GPU, label a small evaluation set, quantify false positives and missed concerns, parse outputs strictly, and preserve present/absent/unsure plus human review. Unknown and visually unobservable conditions must stay unknown. A model proposal must never enter a plan without confirmation. Describe this as future work until it actually exists; AI development-tool disclosure is required independently of whether the shipped app uses AI.

### 5.4 Program screening and locally verified data

programs/<state>/<county>.json, one object per program:

- id, name, administrator, jurisdiction (federal, state, county, city, nonprofit), covers (funding_tags), amount or benefit description
- rules: explicit criteria evaluated as met, not_met, or unknown; applicable facts include age, household size, current county income table/year, homeownership and occupancy, rural eligibility, ability to obtain affordable credit elsewhere, veteran status, Medicaid/waiver enrollment, disability, service area, and any program-specific conditions
- apply: administrator contact, phone, URL, required documents, and any sourced application window or timeline; do not invent a typical approval time
- citation, verified_on, service_area, intake_status, administrator_review_required, and known limitations of the screening rules

Engine: applicant facts and a confirmed concern's funding tags in; relevant programs and criterion explanations out. Preserve missing answers as unknown. An income band crossing a limit is unknown, not an assumed match. Use three screening states: `criteria_matched` (all modeled criteria met, administrator review still required), `needs_information` (unanswered or unmodeled requirements remain), and `known_criterion_not_met` (a confirmed applicable requirement fails). Show each matched, failed, and unanswered criterion, the source/date, service-area/intake information, and the next contact. Never label these results final eligibility, approval, or guaranteed funding. Separate current program intake from whether the applicant appears to meet modeled criteria.

For USDA Section 504, include homeowner occupancy and inability to obtain affordable credit elsewhere as well as age, county/household-size income limits, eligible rural location, and covered repair type. Unmodeled administrator requirements remain visible for review. USDA's own automated worksheet is not a final eligibility determination. Source: [USDA Section 504 requirements and screening guidance](https://www.rd.usda.gov/programs-services/single-family-housing-programs/single-family-housing-repair-loans-grants), checked October 15, 2026. Tests for every included program must cover matched, missing-information, failed-criterion, irrelevant-work, and service-area cases.

Verify three to five genuinely relevant programs for one county before publishing their records. Candidate sources are USDA Section 504, the local aging agency, an actual local nonprofit repair service, and county/city repair programs. Medicaid waivers, VA programs, and Medicare Advantage are additional candidates only if their specific local applicability and criteria can be documented; broad benefit categories are not verified local program records. If no applicable verified program is found for an item, say so and provide a relevant information contact. Keep fewer programs rather than implying an affiliate, benefit, or open intake exists.

### 5.5 Plan and PDF

Generate a readable PDF client-side: home nickname, date, room photo or optional scene thumbnail, prioritized concerns and actions, evidence/confirmation, approximate cost bands, work categories, and assistance programs with matched/unknown criteria, source dates, and contacts. Include request status only when used. Aim for one page for a short plan, but allow additional pages so citations and uncertainty remain legible. Footer: "Checklist aid, not a clinical assessment or complete safety inspection. Program screening is not approval; confirm current requirements with the administrator."

---

## 6. Submission helper flow: invitation-only requests

### 6.1 Data models

- Org: id, name, contact, membership_verified_by, membership_verified_at; a self-entered code does not verify membership
- Helper: id, name, email, invited_by, optional org_id; no public directory, radius search, or skill-ranking profile in the submission
- Home: id, owner_contact, family_contact, optional coarse location, optional scene_id, consent_shared_at
- Plan and PlanItem: as in section 5
- Request: id, plan_item_id, status (requested, accepted, scheduled, done, confirmed), required_helpers (2 if inside), family_present, window, created_at
- Invitation/Assignment: request_id, helper_id, invited_at, accepted_at, scheduled_for, revoked_at
- Completion: request_id, confirmed_by (senior or family), confirmed_at, note; a demonstration uses clearly labeled sample completion

### 6.2 Required work and access constraints

- Inside requests require two accepted helpers and either verified organization membership for both or family_present set on the request. Record who verified membership; these workflow rules do not prove background screening or competency.
- Generate requests only for reviewed low-risk items whose work category allows volunteer help. Route electrical, plumbing, gas, roofing, work above six feet, and installation of load-bearing supports such as grab bars/rails to qualified professionals.
- A helper sees only family-approved material for an active invitation. Enforce ownership, consent, and invitation checks on photos, scenes, thumbnails, downloads, and plans themselves; hiding links is insufficient. Revocation removes future access through the service.
- The app does not publish exact addresses. The family coordinates location privately with a known helper after acceptance.

### 6.3 Matching: after submission

No score or public recruitment in the submission. The family chooses someone it already knows. A future scorer would first exclude helpers outside their radius, missing any required skill, or without overlapping availability, and only then rank eligible candidates. Qualification and safeguarding require separate evidence; a high match score is not proof of either.

### 6.4 Flows

- Family: choose an eligible plan item, approve the task information/photos, invite a known helper, and confirm actual completion later.
- Helper: authenticate through the invitation, review approved task information and photos or optional scene, accept or decline, and mark work done. Inside requests cannot be scheduled until the helper-count and supervision/organization constraints pass.
- Keep professional tasks as contact/referral actions. Do not create a volunteer installation request for them. If secure sharing cannot be completed by the feature freeze, omit in-app helper access, retain a family-only request log, and demonstrate the PDF handoff with sample data.

---

## 7. API

Core auth: email magic link, session cookie, roles family and invited helper. Verify link expiry/single use, session ownership, and CSRF protection for mutations; do not expose private data until the access tests pass. If shared access misses the freeze, use the family-only variant from section 6.4.

- POST /homes; GET /homes/{id}; POST /homes/{id}/photos; GET /photos/{id}
- GET and POST /homes/{id}/concerns (checklist answers, room/photo pins, evidence, confirmation, optional tape measurements)
- POST /plans -> plan from confirmed concerns; GET /plans/{id}
- POST /program-screening -> relevant programs with matched, failed, and unknown criteria
- GET /me; PUT /me
- Core family-owned log in both variants: POST /plans/{id}/items/{item}/requests; GET /requests?mine=1; PATCH /requests/{id}; POST /requests/{id}/confirm. In the family-only variant, label acceptance, scheduling, and work status as family-recorded coordination outside the app, not authenticated helper actions. Preserve work-category constraints and family-only completion confirmation.
- If sharing passes its gate: POST /requests/{id}/invite; POST /requests/{id}/accept; POST /requests/{id}/schedule; POST /requests/{id}/done; POST /requests/{id}/revoke; helpers may list only their active invitations/requests. Shared-request state changes must enforce invitation, actor, helper-count, and supervision/membership constraints regardless of endpoint, including family PATCH updates.
- If 3D passes its gate: capture status, scene retrieval, and scene-pin endpoints only. No vision-proposal, orbit-video, or public volunteer-list endpoints in the submission.
- DELETE /homes/{id} removes linked active photos, optional scenes/keyframes, concerns, plans, screening results, invitations, and requests. All active uploads and derived media expire after 30 days unless the family explicitly keeps them. Apply expiry and deletion to every derived asset and document backup retention separately.

---

## 8. Testing, quality, and privacy

- Engines: pytest in CI for confirmation boundaries, traceability, deterministic ordering, program relevance, unknown facts, failed criteria, and request constraints. Test counts are reporting information, not the definition of done.
- Core web: a meaningful browser test uploads a sample photo, saves a concern/pin, confirms it, reloads, reviews the plan and program criteria, and exports a readable PDF. Exercise no concerns, incomplete answers, missing data, failed upload, and no applicable program.
- Sharing, if shipped: uninvited and revoked accounts must not retrieve another home's photo, plan, or optional scene through direct URLs/API calls. Verify that an inside request cannot be scheduled with one accepted helper or missing required supervision/membership, a professional item cannot create a helper request, and only the family can confirm completion.
- Optional capture: test keyframe selection, image orientation, per-frame intrinsics scaling, matrix serialization, a required nonempty `ply_file_path`, file existence, and seed alignment against fixtures.
- Optional worker: run the pinned binary against a real seeded bundle, produce a loadable scene, save/reload a pin, and record actual elapsed time and peak VRAM. Also reject missing/empty/malformed seed inputs. Do not invent a three-minute performance guarantee.
- Dimensions: the submission uses labeled tape inputs and tested units. Scene-based dimensions stay experimental until a separate multi-dimension, repeated-capture validation supports an error bound; near-target values must require re-measurement rather than a confident safety result.
- Usability evidence: run the bounded comparison in section 2.4 before filming. Record observed task outcomes and confusion. Do not report fewer falls, complete hazard coverage, approved benefits, or repairs completed unless those outcomes actually occurred and were documented.
- Accessibility: large tap targets, high contrast, screen-reader labels on the plan, since the secondary user is older.
- Privacy page: accurately describe stored photos, concerns, plan, optional scene/keyframes, and any coarse location; hosting location; 30-day active retention; consent and invitation access; deletion; and backup expiry. Keep seven daily backups with a maximum seven-day retention; exclude active-deleted records/media on restore before reopening access. Disclose that backup copies may persist until expiry. Do not advertise local-only processing or immediate erasure from backups unless implemented and verified.

---

## 9. Deployment

Core docker-compose on the Ubuntu homelab: API (uvicorn), web (static build served by nginx), private upload storage, and SQLite. Expose through a Cloudflare Tunnel only after auth/asset-access checks pass. Add the CUDA worker only if the optional 3D path passes. No vision service is required. Nightly consistent backups follow section 8's retention and restore policy.

Keep two consented/redacted photo examples in data/samples, with clearly labeled sample concerns, program facts, and request history. Add a preprocessed scene only if produced by the admitted pipeline. The judge demo must work without a GPU and must never depend on live training. Show preprocessing time separately from capture and interaction; do not edit these together into an implied instant reconstruction.

---

## 10. Team, schedule, and definitions of done

### 10.1 Roles

- You (A): confirmed-concern engine and integration; optional capture/worker prototype only within the early time box. Once the gate closes, return to the core.
- Teammate 1 (B), if confirmed: web checklist, photos/pins, plan and PDF, county program records and explanations.
- Teammate 2 (C), if confirmed: API, auth/consent, invitation-only requests, access tests, and deployment.

These are work packages, not proof that teammates have committed. Confirm availability on Day 1. Solo scope is the same photo/checklist/plan/program core with a family-only request log and PDF handoff; omit optional 3D and shared helper accounts. Do not retain a custom iOS/GPU pipeline as a solo requirement. Add any shared helper flow only if core completion and access-control evidence leave time.

### 10.2 Day by day: milestone targets, not validated effort estimates

The schedule is a target for the reduced scope. Update it from actual progress each day; do not assume a fixed number of hours will deliver an unfamiliar subsystem. If starting later than October 15, keep the core and submission dates, and omit optional work rather than compressing its gates.

Day 1, Oct 15. Register, complete the eligibility quiz, confirm district, team availability, and county. Create the photo/checklist web path and API persistence. Draft the first reviewed concerns. Done when a room photo and confirmed concern can be saved and reloaded. If a confirmed teammate can protect this core work, start the optional 3D time box; otherwise omit it.

Day 2, Oct 16. Connect confirmed concerns to ordered actions and a first PDF. Verify the first local program record with source/date, criteria, and contact. Optional prototype: export a seeded ARKit bundle and run the actual OpenSplat loader/training. Done when a photo-based concern becomes a shareable plan, independent of 3D.

Day 3, Oct 17. Close the optional 3D gate within 48 hours of its start and no later than evening. Pass requires capture through render and a persistent pin with metrics. On failure, freeze the photo path as the submission capture mode. Connect program screening to plan items with visible unknowns. No alternate reconstruction project begins.

Day 4, Oct 18. Complete the owner journey and relevant engine/browser tests: photo, confirmation, plan, assistance explanations, PDF, save/reload. Done when the whole core flow runs without a GPU and without placeholder program claims. If this milestone fails, cut all optional work immediately.

Day 5, Oct 19. Aim for three to five verified, genuinely relevant programs for the chosen county; fewer is acceptable with transparent no-match states. Add the family request log. If core work is stable and teammates can own auth/access tests, integrate invitation-only helper acceptance and completion. No scored matching or public sign-up.

Day 6, Oct 20. Exercise the flow using a second consented/redacted room or home example. Check sources, incomplete inputs, no-match results, professional referrals, PDF legibility, and persistence. Optional 3D must not delay fixes in the core.

Day 7, Oct 21. Run the small usability comparison from section 2.4. Record who completed each task, how long it took, and what was misunderstood. If shared helper access is included, run direct-asset, consent, revocation, and request-constraint checks. Remove shared access if those checks do not pass.

Day 8, Oct 22. Fix observed usability problems; verify keyboard/phone use, labels, empty/error states, deletion, and actual retention behavior. Freeze features at 9 pm. The final product is either the tested invited-helper flow or the family-only log/PDF variant; describe the shipped variant accurately.

Day 9, Oct 23. Required checks pass; prepare README, library/AI disclosures, privacy text, written answers, and sample data. Record only implemented flows. Draft the hardest-problem answer from an actual bug and its evidence.

Day 10, Oct 24. Film/edit the public 1-to-3-minute video. Have someone outside the team explain the app and its limitations after watching. Verify the deployed sample demo and video link while logged out; fix submission blockers only.

Day 11, Oct 25. Submit all materials, verify the public video and judge access, and retain the confirmation. Keep the October 26 noon EDT planning limit because official deadline times conflict.

### 10.3 Scope and acceptance checks

- October 17: admit only a proven optional 3D path; otherwise use photos. No vision model, scored matching, orbit rendering, or automated clearance decisions enter the submission schedule.
- October 18: require the complete photo-to-plan-to-assistance-to-PDF path. If incomplete, stop optional work and concentrate on this journey.
- October 21: require access/consent tests for shared helper accounts; otherwise use a family-only log and PDF handoff. Do not replace missing privacy controls with a disclaimer.
- October 22: freeze features. Preserve confirmation, cited actions, honest program states, readable export, persistence, and tested private-data access. Cut decorative work and program quantity before weakening these requirements.
- Final acceptance: demonstrate the shipped path on the actual deployment, preserve test and small-pilot observations, label sample histories, and verify that every claim in the video matches working behavior. Build success or a test count alone is not acceptance.

---

## 11. Video

### 11.1 Script (target 2:50)

- 0:00 to 0:15. A room photo with a documented concern. Voice: "When a family spots a problem at home, deciding what to do and where to get help can take several separate steps." If using a fall statistic, cite its exact population, measure, and year on screen; do not imply that all falls are visible or preventable through this app.
- 0:15 to 0:30. Names, "FixList", the family/helper audience, and the revised one-sentence purpose.
- 0:30 to 1:25. Open a room photo, answer checklist questions, and confirm concerns. Show evidence, priority explanation, suggested action, approximate cost band, and a professional referral where appropriate. If 3D shipped, briefly show the same concern in the scene and disclose preprocessing time. Use a labeled tape input rather than an unvalidated scene measurement.
- 1:25 to 1:55. Open a genuinely relevant local assistance record. Show matched and unanswered criteria, source/date, contact, and "administrator review required". Show a no-match or missing-information state, then export the plan.
- 1:55 to 2:15. Demonstrate a request to a known helper only if shared access passed its gate; otherwise show the family log and PDF handoff. Label the request/completion history as sample data unless an actual repair occurred. Do not imply a public network or vetted workforce exists.
- 2:15 to 2:35. Show the implemented architecture and a relevant check or measured pilot observation. State only the languages/tools actually used; mention Swift/OpenSplat only if that path shipped. Disclose AI development assistance as applicable.
- 2:35 to 2:50. Explain an actual technical difficulty, how it was verified, and one bounded next step. Names/end card. Do not describe planned functionality as completed work.

### 11.2 Production

Record phone capture with a gimbal or steady hands in daylight. Screen-record the web app at 1080p with a clean browser profile. Use captions throughout. No music louder than the voice. Export at 1080p, upload public, test the link logged out.

---

## 12. Written answers (drafts to refine)

- Purpose: see the one sentence.
- Inspiration: describe the real family or prior-project experience only if it occurred. Acknowledge ChoreMap lineage and relevant alternatives. Explain the proposed connection from documented concern to local assistance and follow-through; do not claim that room scanning or photo-based home assessment is new.
- Hardest technical problem: choose a difficulty actually encountered in the shipped path and explain the observed failure, correction, and check. Use seeded capture/reconstruction or GPU budgets only if worked on; a failed optional prototype may be discussed honestly as a scope decision.
- What you learned: draw from actual implementation and pilot evidence, such as handling missing eligibility facts, preserving confirmation, preventing unauthorized asset access, or choosing a photo path after a failed 3D gate. Do not prewrite findings.
- 2.0: evaluate whether 3D or vision adds value over photos; validate scene measurements before clearance features; expand locally maintained program records; and explore an aging-agency intake workflow with a willing partner. These are proposed next steps, not commitments or partnerships already secured.

---

## 13. Submission checklist

- Registration complete for every teammate; eligibility quiz passed; team profile created and invitations accepted.
- District confirmed as hosting; at least half the team eligible there.
- Video 1 to 3 minutes, public, states names, app name, purpose, audience, tools and languages, shows functionality.
- Written answers finalized against actual work; AI development assistance and third-party components disclosed with substantial student contributions and technical understanding documented.
- Repository public or shareable with judges; README with setup, architecture diagram, library and AI disclosures, privacy page, and sample data to run without a GPU.
- Live demo URL with two consented/redacted photo examples and clearly labeled sample history; optional preprocessed scene only if the 3D gate passed. Core judge demo runs without a GPU.
- No claims of comprehensive hazard detection, guaranteed funding, validated clearance accuracy, clinical effectiveness, or operational volunteer vetting without supporting evidence. Verify that the competitor descriptions remain accurate and bounded.
- Submit by October 25; keep the confirmation screenshot.

---

## 14. Risk register

| Risk | Trigger | Response |
|---|---|---|
| Novelty claim overlaps prior work | HomeFit AR or SafeHavenAI already provides the claimed feature | Acknowledge direct overlap; evaluate the combined assistance/follow-through workflow without asserting uniqueness |
| Core behind schedule | No complete photo-to-plan/PDF path by October 18 | Stop optional work; reduce quantity and polish, preserve confirmation and truthful outputs |
| Optional splat pipeline not working | No real seeded capture-to-render/persistent-pin path within 48 hours, no later than October 17 | Stop 3D for this submission and use ordinary photos; no late reconstruction rescue ladder |
| Missing or invalid seed | Missing `ply_file_path`, unreadable/empty PLY, or misaligned points | Reject input; repair only within prototype time box; no random-initialization fallback |
| VRAM out of memory | Optional training crashes | Try one bounded smaller configuration within the original time box; record result and stop if gate fails |
| Poses/images disagree | Mirrored output, seed projection mismatch, or incorrect orientation | Inspect pose serialization, image orientation, intrinsics, and seed alignment together |
| Scene dimensions misleading | Unvalidated error or ambiguous physical-edge picks | Use labeled tape inputs; defer scene-based clearance judgments |
| Viewer too slow on phones | Actual target phone struggles or WebGL fails | Use existing room photos, concern list, and plan |
| Program data incomplete or wrong | Missing local applicability, stale source, or unknown criterion | Show unknowns/no match, reduce program count, and direct to administrator; never promise funding |
| Helper sharing unsafe or incomplete | Direct-asset, invitation, consent, or request-constraint checks fail | Remove shared helper access and use family-only log/PDF handoff |
| Teammate unavailable | Confirmed owner cannot deliver assigned milestone | Apply solo scope; drop optional 3D/shared accounts and preserve the core |
| Privacy promise exceeds behavior | Deletion/expiry or backup retention cannot be verified | Correct behavior or remove the unsupported promise before real private uploads |
| Rules question about prior project | ChoreMap authorship or reuse unclear | Document lineage and contributors, separate new work, and resolve rights; filtering commit authors alone does not establish sole ownership |

---

## 15. After submission

- If selected, prepare a longer House of Code demo using the implemented path and consented sample data.
- Seek a willing local aging agency or service club for a bounded pilot; outreach requires a separate explicit instruction to send messages. No partner or adoption is currently established by this plan.
- Explore deferred 3D/vision/matching work only after testing its added value and resolving the relevant accuracy, privacy, and operational gates.
- Before any open-source release, verify contributor rights and dependency licenses, then choose compatible licensing for original engines/taxonomy with disclosures intact.
