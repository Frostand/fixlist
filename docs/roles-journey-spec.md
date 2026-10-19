# Elder and volunteer journeys — iOS demo spec (2026-10-18)

Binding scope for the milestone after the October 18 review. Deadline context: Congressional App Challenge submissions close **12:00 pm EDT, Monday October 26, 2026**. Andrew asked for an iOS app that is "just demo and enough for the contest", so this milestone stays local-only: no backend, real accounts, network sync, email/SMS or analytics. Server-dependent requirements (real sign-in and recovery, shared persistence, notifications, moderation operations, published legal documents, server-side deletion) are written up as a 2.0 plan in `docs/v2-accounts-plan.md`, not simulated as if they existed.

## Milestone journey (must work end to end on the iOS Simulator)

Elder chooses language → creates a demo profile on this device → completes a short setup guide → answers the room checklist (optionally with a photo) → confirms a concern → approves a help request and chooses what to share → invites a volunteer → *switch person* → volunteer accepts and proposes a visit time → *switch* → elder agrees → *switch* → volunteer posts a progress update and reports completion → *switch* → elder reviews the report: "Yes, it's done" or "Not done yet" (reopens).

## People, roles and permissions (pure domain, enforced in `applyCommand`)

Every command carries `actorId`. `applyCommand` rejects any command the actor's role and grants do not permit, with a plain-language error. Tests cover each allowed and denied pair, role tampering (an actor ID not in state, a volunteer issuing resident commands), expired or withdrawn invitations, and revoked delegations.

| Action | Resident (elder) | Family helper (delegate) | Volunteer |
| --- | --- | --- | --- |
| Answer checklist, add/remove own photos | yes | if granted `checklist` | no |
| Confirm/unconfirm a concern | yes | if granted `confirm` | no |
| Create a help request (draft) | yes | if granted `requests` | no |
| Approve sharing, invite or cancel a volunteer, cancel a request | yes | no (the resident approves) | no |
| Grant/revoke a delegation | yes | no | no |
| See household checklist, plan, photos, scan | yes | per grants | no |
| See a request | yes | if granted `requests` | only requests they were invited to, and only the shared fields |
| Accept/decline an invitation, propose a time, post an update, report completion, withdraw | no | no | only on their own invitation/assignment |
| Agree to a proposed time, acknowledge completion or reopen | yes | no | no |

Choosing "volunteer" never grants household access or implies vetting. Volunteer skills and availability are self-declared and always labeled "Self-reported, not verified". Attribution is preserved: every record stores who did it ("Sam (family helper) for Margaret").

## Help request lifecycle

`draft` → `invited` (resident approves sharing and invites exactly one volunteer) → `accepted` | `declined` → `scheduled` (volunteer proposes, resident agrees) → `in_progress` (first update) → `volunteer_reported_done` → `resident_confirmed_done` | back to `in_progress` (resident: "Not done yet"). Also: volunteer `withdraw` (→ draft, the volunteer loses access), resident `cancel` (→ cancelled, kept as history), and reassignment (cancel the invitation, then invite someone else). A second acceptance or a stale update (wrong `expectedRevision`) is rejected. Volunteer-reported completion, resident acknowledgment and independent verification stay distinct; independent verification is "not available in this demo". Requests stay tied to plan actions: removing the confirmation keeps the request as inactive history (existing rule).

Professional-review actions (handrail, stair lighting, bathroom support) can't be assigned to volunteers. Their request offers "Find a qualified professional" plus local-help resources, and says volunteers do not do electrical, structural, plumbing or grab-bar installation work.

## Sharing (granular, revocable)

When inviting, the resident picks what the volunteer sees: task title and next step (always), room name, the resident's photos for that concern, the room-scan location image, preferred visit times, and an approximate area label (fictional; never a street address). The volunteer view renders only shared fields. Revoking a field removes it from future views immediately and shows the resident: "They may already have seen this. Revoking stops future access on this device."

## Elder experience (WCAG 2.2 AA target, iOS-first)

- Home screen: one large "Your next step" card, then Check your home, Your plan, Help requests, Updates, Find local help, Settings/Help. No 3D required for any essential task; the room scan is an optional extra.
- Checklist walk-through: one question per screen, Back/Next buttons, "Question 3 of 8" progress, autosave with a visible "Saved on this device" status, resume where you left off.
- Text 20 px base and scalable (respect iOS text size; no fixed px line boxes), 48 pt minimum targets, 4.5:1 contrast, visible focus, no drag-only operations (scan has buttons), reduced-motion respected, VoiceOver labels on everything.
- A Help button on every screen opens plain-language help for that screen.

## Volunteer experience

Home screen: Invitations (accept/decline with reason), My tasks (shared details, next step, materials if authored, boundaries), Propose a time, Post an update, Report done, Withdraw. "My skills & availability" (self-reported). A boundaries card: no electrical, structural, plumbing, roof/ladder or grab-bar installation work; meet the resident only with agreement; indoor-visit safeguards as already authored.

## Switching people (demo accounts)

First launch: language picker → "Who is using FixList?" with demo profiles (Margaret, resident; Sam, family helper; Alex, volunteer) and "Create a demo profile" (name, role, language; no password). A persistent banner reads "Demo profiles on this device — no real accounts or sign-in yet". "Switch person" returns to the picker. Each person's language and setup-guide progress are stored separately.

## Language

English and Spanish at launch, chosen before choosing a profile and remembered per person. All UI strings, catalog text (checklist, actions, next steps), errors and the printable report go through typed dictionaries with compile-time key parity. The Spanish dictionary is marked `reviewed: false`. While it is unreviewed, Spanish screens show "Traducción automática; aún no revisada por una persona hablante nativa". User-written notes are never machine-translated and are labeled as written by the user.

## Setup guides

Elder: 4 short cards (what FixList does and doesn't do, check your home, confirm what to fix, ask for help and choose what to share). Volunteer: 4 cards (invitations, what you will see, task boundaries and privacy, reporting progress and completion). Each card can be skipped, progress is saved, and the guide can be replayed from Help.

## Practical next steps and local help

Each action gains an authored, cited `nextStep` (plain language, based on the CDC 2017 Check for Safety brochure) and an `effort` label: quick fix / helper task / needs a professional. The plan is grouped by effort, and that grouping is explained as a reading aid, not a risk ranking. "Find local help" lists the real Eldercare Locator (Administration for Community Living; eldercare.acl.gov; 1-800-677-1116), with source and verified date, above the two clearly fictional programs.

## Photos

On iOS, "Add a photo" uses the camera or photo library through a file input. Photos are downscaled to at most 1600 px, stripped of metadata by re-encoding, stored in IndexedDB on the device, never uploaded, and removable. They appear in the plan and the printed report, and reach a volunteer only if shared.

## iOS packaging

The app is packaged as a Capacitor iOS app (WKWebView) built from the same Vite build. Camera and photo-library usage strings are set in Info.plist, and safe-area insets are respected. A demo build script copies a chosen local scan (default `viennese-v2`) into the app bundle's gitignored web assets, so the scan works offline without the dev server. The production web build and Git never contain scans.

## Storage

Bump the `fixlist:demo:v1` payload to version 3 (people, delegations, grants, help requests, sharing, photos index, per-person language/onboarding, active person). v2 data migrates in memory, without rewriting it: old family requests become help requests attributed to "Family record (before roles)", with their status mapped and history preserved. Reset clears only FixList keys and stores.
