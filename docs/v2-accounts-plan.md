# FixList 2.0 plan: accounts, sharing and safety

*Status: a plan. Nothing in this document is built. Written October 18, 2026.*

## Where we are, and why 2.0 exists

The current FixList is a local-only iOS demo. It is a Capacitor app wrapping a React/TypeScript app. It has demo profiles on one device: a resident (Margaret), a family helper (Sam) and two volunteers (Alex and Jordan). Role permissions are enforced in pure domain logic, and all data stays on the device. There is no server, sign-in, sync, notification, moderation, or published legal document. Offline AI room suggestions are labelled as unverified "areas to review".

A real version needs a server, because several protections can't exist on one device: sign-in, access that can be revoked, shared records, and a way to handle reports. This plan describes what we would build and decide first. Each section lists the design, the open decisions, and what must be true before launch.

## 1. Account lifecycle

**What and why.** Creation, contact verification, sign-in, sign-out, session expiry and recovery. For an older adult, a lockout can mean losing access to help. For a volunteer, a weak account can expose someone's home details.

**Design.**
- Passkeys are the preferred sign-in. Password plus a verified code is a fallback.
- Sign-in must meet WCAG 2.2 SC 3.3.8 (Accessible Authentication). That means no memory or puzzle tests, and password managers and paste must work.
- Contact verification uses a one-time code. Responses do not reveal whether an account exists.
- Sessions expire after inactivity. "Sign out" is always visible, with a "Shared device? Sign out when finished" prompt.
- Recovery follows the [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html). It uses more than one recovery method, and every recovery is logged and notified.

**Open decisions.** What happens if the person loses their original recovery method. A likely answer is a delay plus confirmation from a pre-chosen trusted contact. We would test it with older adults, not assume it works.

**Before launch.** Recovery has been tried end to end by people who lost a device. Sign-in works with VoiceOver and large text.

## 2. Server-side authorization

**What and why.** The demo's permission table (resident, family helper with grants, volunteer limited to invited requests and shared fields) becomes the rule for every server request. Hiding a button on the phone protects nothing.

**Design.**
- The same table is enforced for every request. Anything not allowed is denied by default.
- Each record belongs to a household, and every query is scoped to it.
- Tests cover each allowed and denied role/action pair, tampered identifiers, revoked grants and withdrawn invitations.
- Household isolation tests try to read, change or guess another household's records. See the [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

**Before launch.** Every endpoint has an authorization test, and a cross-household test fails closed.

## 3. Security

**What and why.** Photos and room details of an older person's home are sensitive.

**Design.**
- Secure session cookies or tokens, plus rate limits on sign-in, codes, invitations and uploads.
- Secrets kept in a secret store, never in the app or Git.
- Uploaded files are checked for type, size and content, re-encoded, and stripped of metadata.
- Media is served through signed, short-lived URLs.
- Audit logs record sign-ins, sharing changes, access revocations and admin actions.

**Risks.** Logs themselves hold sensitive data, so access and retention need rules.

**Before launch.** An independent security review of the server and an incident contact path.

## 4. Shared persistence and sync

**What and why.** Resident, helper and volunteer need to see the same request state.

**Design.**
- The server holds the authoritative records and checks ownership on every write.
- The demo's `expectedRevision` approach carries over. A stale update is rejected, and the person sees what changed and chooses what to do.
- The app shows saved, saving, offline and failed states. A write that can't be saved is never shown as saved.
- Local room scans and photos are never uploaded automatically. Uploading is a separate, explicit, per-item choice.

**Open decisions.** Whether to sync photos at all in the first release.

**Before launch.** Tests for offline edits, duplicate retries and simultaneous changes.

## 5. Notifications and messaging

**What and why.** People shouldn't have to keep checking the app. Updates cover task questions, invitation responses, schedule changes, cancellations and completion.

**Design.**
- Notifications are sent in each person's language, with preferences for what they receive and how.
- Previews are generic ("You have an update in FixList"). They contain no address, room, health or photo detail.
- Messaging is limited to a task. No open chat in 2.0.

**Open decisions.** Push, email or text, and who pays for text.

**Before launch.** Previews checked on a locked phone. Opt-out works.

## 6. Volunteer suitability

**What and why.** "Volunteer" must never imply "safe to let in."

**Design.**
- Self-declared skills stay labelled "Self-reported, not verified". Verified qualifications are displayed separately, with the verifier named.
- Age, supervision and organization requirements are set per task.
- Task boundaries stay as in the demo: no electrical, structural, plumbing or grab-bar installation work.

**Open decision.** We should partner with an existing volunteer organization that already runs background checks, rather than vet volunteers ourselves. Even then, a check does not establish competence or guarantee safety, and we would say so.

**Before launch.** A signed partner arrangement or an equivalent decision. Nobody is called "vetted" without a named verifier.

## 7. Moderation and support operations

**What and why.** Problems will happen, and people need a way to report them.

**Design.**
- Reporting and blocking are available from every task. The resident can revoke a volunteer's access at once.
- A disputes path covers "not done" claims and no-shows.
- A named person or organization handles reports, with a response-time goal we can actually meet.
- Admin access is limited and every view is logged.

**Open decisions.** Who staffs this, since a student project can't promise 24-hour response.

**Before launch.** An emergency notice ("call 911") and a clear statement of what FixList does not handle.

## 8. Terms, privacy and volunteer rules

**Design.** Three documents:
- Terms of Service.
- Privacy Notice covering what is collected, why, who sees it, how long it is kept, and how to delete it.
- Volunteer rules covering boundaries, conduct and reporting.

Each acceptance is recorded with document version and date. Plain-language summaries sit alongside the full text.

**Before launch.** An appropriate adult and legal review, with minors' data and age rules considered. We will not publish drafts as if they were reviewed.

## 9. Data export and removal

**Design.**
- A person can leave a household. A resident can remove a family helper or volunteer, which ends access at once.
- Export gives the household its records in a readable form.
- Deleting an account removes personal data. Shared task history may keep a minimal, anonymized record, because other people's records depend on it.
- Backups and retention periods are written down, and deletion from backups has a stated time limit.

**Open decisions.** What happens to a deceased or incapacitated resident's household.

**Before launch.** Deletion and export are tested, and the Privacy Notice matches what the system does.

## 10. Translation

**Design.**
- Critical text (safety boundaries, consent, legal, notifications) is reviewed by a professional or fluent speaker.
- Machine-translated text is labelled as such until reviewed. The demo already marks Spanish as unreviewed.
- User-written notes are never auto-translated, and they are labelled as written by the user.

**Before launch.** Each launch language has a named reviewer for critical text.

## 11. Evaluation

**Usability.** Compare FixList against a paper checklist holding the same information, with older adults and volunteers. Measure time to the correct next action and error counts, with counterbalanced order. Small samples give descriptive results only, with no claim about fall reduction.

**Accessibility.** Test with VoiceOver, large text and reduced motion on real devices.

**Model calibration.** Test the photo model on real home photos from people who consented. Report how often "areas to review" matched what a person found. The model weights are CC BY-NC 4.0, non-commercial only, so a public release may need a different model or a license.

**Before launch.** Results are published as measured, including negative ones.

## If we had three more months

1. Sign-in, recovery and server-side authorization, with isolation tests.
2. Shared records and sync for one household, plus basic security.
3. The paper-checklist comparison and accessibility testing with older adults.
4. A partner volunteer organization and the reporting path.
5. Legal and adult review of the documents, then a small, supervised pilot.

## Answer for the contest's 2.0 question

*Draft — Andrew: rewrite this in your own words before submitting.*

For 2.0, I would turn the demo into a real service. Demo profiles on one phone would become real accounts with safe recovery, and the permission rules I tested on the device would be enforced on a server so households can't see each other's data. I would partner with an existing volunteer organization instead of vetting volunteers myself. I would also have adults review the terms and privacy notice, and compare FixList against a paper checklist with older adults. None of this exists yet.
