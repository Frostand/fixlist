# FixList: CAC 2026 written submission packet

Deadline: **12:00 pm EDT, Monday October 26, 2026.** The questions below are the six listed in the official 2026 rules (the live form may word them slightly differently). Items in [brackets] need Andrew before submitting. Everything else is drafted from the repo's records and checked against the app.

---

## 1. What is the title of your app?

FixList

---

## 2. Explain the app's purpose.

FixList helps a family check an older relative's home for fall risks, agree on what to fix, and get the fixes done with people they trust. It is for older adults, their families, and the volunteers who help.

FixList is an iPhone app. A resident answers a home checklist one question at a time. A "Yes" does not go straight into the plan. The resident confirms it separately, and only then does it become a plan item. Each plan item has a plain-language next step based on the CDC's "Check for Safety" checklist and a note on who can usually do it. The resident can then ask for help and choose exactly which details to share. A volunteer sees only what was shared. The volunteer can accept, propose a time, post updates and report the job done. The resident decides whether it is done. FixList records what people report and does not check a repair. The resident can print a report. The app also works in Spanish, which is machine-translated and has not been reviewed by a person.

Optionally, a room walk-through or 3D scan can be added. A Mac-local AI model can then suggest photo "areas to review." These are not findings. They never answer the checklist, and the resident decides.

The demo uses a fictional household and demo profiles on one phone. It has no real accounts and no server.

---

## 3. What inspired you to create this app?

The inspiration is a gap that many families run into. About one in four adults 65 and older falls each year, according to the CDC (CDC, Older Adult Fall Prevention, cdc.gov/falls). After a fall or a hospital discharge, a family often gets a paper home checklist. Then the practical questions start. Who walks through the house with it? Which items matter? Who is fixing the loose rug, and who agreed to do it? Nobody tracks that, and the person whose home it is can get left out of decisions about her own space.

FixList is built around that gap rather than around the checklist alone. The resident confirms every item before it becomes a plan item. She chooses exactly what a volunteer can see. Nothing is marked done until she says so. The goal is for the older adult to stay in charge of her own home while family and volunteers help.

[Andrew: add one true sentence about why this matters to you, or delete]

---

## 4. What technical/coding difficulty did you face in programming your app, and how did you address this technical challenge?

**Keeping each role to what it is allowed to see.** One phone holds a resident, family helpers and volunteers. A volunteer must never see more than the resident shared, and hiding a button is not enough for that. The rules live in the app's core logic rather than in the screens. Every change is a typed command that goes through one function, `applyCommand`. It checks role, grants, ownership and request revision. The volunteer's view is built field by field. Room name, photos, visit times and location have no key at all unless the resident shared them during a live assignment. Revoking a field removes the key immediately. A test named "volunteer projections omit every unshared field, including on serialization" checks the data itself, not just what is drawn. This is a local boundary. It does not protect against someone who has the device, so a real version needs server-side checks.

**Tying AI output to the exact photos it looked at.** The Mac-local model returns its suggestions in a file. A stale or wrong file attached to the wrong room would show a flag beside a photo the model never saw. So each room capture stores a SHA-256 hash of every photo. An imported flags file must match the capture ID, the room, and every photo ID and hash in order. Otherwise the app refuses it with a `CAPTURE_MISMATCH` error. Scan suggestions are tied the same way to a hash of the exact scene file. Tests cover wrong-capture, wrong-room, reordered and missing-photo cases.

---

## 5. What did you learn while participating in the CAC? What was your biggest takeaway?

My biggest takeaway is that "using AI" is a design decision and not a feature to switch on. FixList only asks the Mac-local model eight narrow photo questions, such as whether a cable is visible across a path. It shows the question the model answered, labels the result an experimental score, and never lets it answer or confirm anything. A missing suggestion does not mean an area is fine.

I also learned how easily a number can look better than the evidence behind it. The model was overconfident on photos without a condition, so a calibration was fitted on 125 example photos using a protocol fixed in advance. On the held-out photos (23 photos, 8 positive pairs), Brier score went from 0.0249 to 0.0129 and the adoption rule was met. But the labels were made by an AI, not an expert, and no second person labeled them. Every item had fewer than 10 held-out positives, and nothing has been tested in real homes. I did not fine-tune the model, because 24 positive pairs was too few to check a fit fairly. I report these as experimental scores, not accuracy.

Finally, I learned that automated tests are how a rule like "volunteers see only shared fields" stays true as the app changes. The current build passes 1,547 automated tests (58 test files, run October 23, 2026). [Andrew: confirm this matches what you took away, or replace it with your own takeaway.]

---

## 6. What would you change about your app if you were to create a 2.0 version?

I would turn the demo into a real service. Today it has demo profiles on one phone and no server. The 2.0 plan is written but nothing in it is built yet.

- **Real accounts and server-side permissions.** Sign-in and recovery would be usable by older adults, including with VoiceOver and large text. The same permission table would be enforced on a server for every request, with tests that try to read another household's records.
- **Shared records.** A resident, helper and volunteer would see the same request state. Stale edits would be rejected, and a failed save would never be shown as saved.
- **Volunteer partners.** I would work with an existing volunteer organization instead of screening people myself. Skills would stay labeled "self-reported" until a named organization confirms them.
- **Reviewed Spanish.** Critical text would be reviewed by a fluent speaker, because the current Spanish is machine-translated.
- **Real-home evaluation.** Consenting people would supply real home photos, with an expert labeler and a second annotator, and at least 10 held-out positives per item. I would also compare FixList with a paper checklist among older adults. The model weights are non-commercial (CC BY-NC 4.0), so a public release might need a different model or license.
- **Physical-device testing.** The ARKit room capture has not yet been tested on a physical iPhone.
- **Adult and legal review** of the terms and privacy notice before any pilot.

---

## AI usage disclosure (CAC rule: all AI use must be fully disclosed)

AI was used heavily in building FixList, and this is a full disclosure. Claude Code (Claude Opus 5.5) helped with design specs, review, integration and some code. OpenAI Codex workers wrote most of the implementation. GPT-6.1 Sol wrote the scan-suggestion pipeline, the roles and permissions logic, the phone screens, the English and Spanish text, and tests. GPT-6 Luna collected license-clear evaluation photos and labeled them by viewing them. Those labels are AI judgments, not expert ground truth. GPT-6 Astra reviewed plans and changes. Claude Sonnet 5.5 helped draft documentation and this submission text. Claude Fable 5.1 suggested demo and video direction. From October 22 to 23, the same tools did the final polish (Claude Opus 5.5 directing and fixing; GPT-6.1 Sol implementing), and produced the demo video: Simulator recordings, editing scripts and a synthesized narration voice (Kokoro-82M). A separate AI review I ran produced an October 18 feedback list [Andrew: name the tool/model, or delete this sentence].

The Spanish text is machine-translated and has not been reviewed by a person. Inside the app, a locally run model (StartLux-Decision v1.1 9B, 4-bit MLX, weights licensed CC BY-NC 4.0) scores narrow photo questions on room-scan frames on my Mac. Nothing is sent to a cloud service. Its output is labeled as unverified "areas to review" and never answers the checklist.

I understand that AI may not be the entirety of the development and that I must show significant individual contribution. My own contribution:

[Andrew: 2–4 sentences on what you personally designed, decided, wrote, and tested. Only claim what you can explain to a judge.]

---

## Tools and languages

TypeScript, React, Vite, Capacitor (iOS), Swift (ARKit capture, print and keyboard handling in the native shell), Python (scan pipeline), three.js + Spark (3D scan rendering), COLMAP, Brush (Gaussian-splat training), ffmpeg, MLX (Mac-local model), Vitest.

---

## YouTube

**Title:** FixList: a family tool for checking an older relative's home | Congressional App Challenge 2026

**Visibility:** Public (required by the rules).

**Description:**

FixList helps a family check an older relative's home for fall risks, agree on what to fix, and get the fixes done with people they trust. It is for older adults, their families, and the volunteers who help. Created by Andrew Lieu for the 2026 Congressional App Challenge.

This is a demo with a fictional household and demo profiles on one phone. It has no real accounts and no server. The AI-suggested "areas to review" are not findings. The app was built with substantial AI assistance, and the submission describes how. The narration in this video is a synthesized voice.

Credits
- Sample room: "UE4Arch.com – Viennese apartment" by UE4Arch.com, Wikimedia Commons, licensed CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/), https://commons.wikimedia.org/wiki/File:UE4Arch.com_-_Viennese_apartment.webm. It is a computer render, not a real home. It was trimmed to 58–158 s, frame-sampled and reconstructed into a 3D scan, and changes were made.
- Next steps are paraphrased from the CDC's "Check for Safety" checklist. Local help resource: Eldercare Locator (Administration for Community Living).
- Mac-local model: StartLux-Decision (code Apache-2.0; weights CC BY-NC 4.0).
- Fonts: Atkinson Hyperlegible and Zilla Slab (SIL OFL).

License: because this video includes adapted CC BY-SA footage, the video is shared under CC BY-SA 4.0.

---

## Open items for Andrew (all short)

1. Write the contribution statement (AI disclosure) and, optionally, the Q3 sentence and the Q5 takeaway. Do not claim authorship of code you cannot explain.
2. Name the tool used for the October 18 outside AI review, or delete that sentence.
3. ~~Check the CDC figure~~ Checked Oct 23: CDC Facts About Falls (cdc.gov/falls/data-research/facts-stats) says "more than one out of four older people falls each year." "About one in four" in Q3 and the video is consistent; you may change Q3 to "More than one in four" if you prefer.
4. Watch the final video once before uploading; optionally re-record the narration in your own voice using the no-voice version and the .srt.
5. Have an adult confirm the CC BY-SA reading for the adapted apartment footage (attribution + modification notice in the description; video shared under CC BY-SA 4.0). The open TODO is in `docs/ai-disclosures.md`, Media and licensing record.
6. CAC student rules page (checked Oct 23) confirms **October 26** as the deadline but gives no time; confirm the 12:00 pm EDT time and the Public-video rule in the complete rulebook or the submission form.
7. Upload to YouTube as Public, paste the description above, then submit the form with the YouTube link.

Evidence for the test count: `npx vitest run` and `npm run typecheck` were run by the parent on October 23, 2026, against the current uncommitted working tree (58 files, 1,547 passed, typecheck clean). If you commit or change code before submitting, rerun them.
