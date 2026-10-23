# FixList: Congressional App Challenge 2026 written submission (draft v1, Sonnet 5.5 from verified facts)

## 1. What is the title of your app?

FixList

## 2. Explain the app's purpose.

FixList helps a family check an older relative's home for fall risks, agree on what to fix, and get the fixes done with people they trust.

It is for families. That includes adult children and other relatives who help, and the older person whose home it is. A volunteer can take part too, but only sees what the resident chooses to share.

The app walks through a checklist paraphrased from the CDC's "Check for Safety." It tracks each item, including what needs fixing and who is doing it. Room scans from a walk-through video become a 3D view of the room. A Mac-local AI model can answer narrow questions about photos from a scan. Its answers appear as "areas to review." They may be wrong, and they never answer the checklist. The resident decides what is confirmed, what to fix, and what to share.

This version is a demo. It uses a fictional household on one phone, with no real accounts.

## 3. What inspired you to create this app?

The CDC reports that about 1 in 4 adults aged 65 and older falls each year. Falls are the leading cause of injury and injury death among older adults.

The CDC also publishes a home checklist called "Check for Safety." It exists on paper. After a fall or a hospital stay, families are handed a checklist like it. Then nobody tracks who fixes what. Items get forgotten. The older person whose home it is can get left out of the decisions.

FixList is built around that gap. It keeps one shared list of what has been noticed, what has been agreed, and who is doing each fix. The resident stays in charge of their own home.

[OPTIONAL — Andrew: add your own sentence about why this problem mattered to you. Only include it if it is true.]

## 4. What technical/coding difficulty did you face in programming your app, and how did you address this technical challenge?

The hardest problem was building a 3D room from a walk-through video of rooms with plain white walls. The pipeline works in steps. ffmpeg picks sharp frames. COLMAP (through pycolmap) estimates camera poses. Brush trains a Gaussian splat on the Mac GPU. The iPhone app renders it with three.js and Spark.

White walls give a matcher little to grab. The first attempt, on a 100-second apartment walk-through, registered camera poses for only 111 of 195 frames (57%) with standard SIFT features. The pipeline was changed to tune SIFT for low texture. It now also falls back automatically to a learned matcher (ALIKED keypoints with LightGlue) when fewer than 60% of frames register.

That caused a new bug. pycolmap and PyTorch crashed when loaded in the same Python process, because two copies of the OpenMP runtime collided. The learned matcher now runs in a separate process.

Trust was a second challenge. AI results ("flags") are bound to the exact photos by SHA-256 hashes. A stale or mismatched results file is refused and can never attach to the wrong room. Role permissions for resident, family helper and volunteer are enforced in the pure TypeScript domain layer. A volunteer view only receives what the resident chose to share.

Finally, a base iPhone 17 has no LiDAR, so Apple RoomPlan was unavailable. A native Swift ARKit plugin records a posed photo tour and a tapped, approximate room outline instead.

[OPTIONAL — Andrew: add one sentence about what you personally debugged, decided or came to understand here.]

## 5. What did you learn while participating in the CAC? What was your biggest takeaway?

My biggest takeaway is that an AI helper should stay a helper. In FixList, the AI model is a narrow tool. It asks specific photo questions and shows the question it answered. Its output is labelled "may be wrong," and a person decides. A model suggestion never answers or confirms a checklist item.

That led to a design idea I value. "Someone said yes" is not the same as "the resident confirmed it." The app keeps those two things apart, because it is the resident's home and the resident's decision.

I also learned how much testing matters when the rules matter. The project has more than 1,500 automated tests in TypeScript with Vitest, plus more than 150 Python tests. Tests turn rules like these into things that can be checked, not just intentions.

[OPTIONAL — Andrew: add one sentence about what you personally learned or found hardest.]

## 6. What would you change about your app if you were to create a 2.0 version?

A 2.0 version would need to move from a demo to something families could actually use.

- **Accounts and permissions.** Add real accounts and server-checked permissions. Today the demo runs on one device with no backend.
- **A real partner.** Work with a real volunteer organization, for example through local Area Agencies on Aging.
- **Spanish.** Have a person review the Spanish text. It is currently machine-translated.
- **Photo model.** Run the photo model directly on the phone once newer iOS tools allow it. It currently runs on a Mac.
- **A proper study.** Run a study with experts before any AI score is treated as more than experimental.
- **Real program data.** Use real program eligibility data in place of the demo content.

Each change moves one part of FixList from "works in a demo" toward "can be trusted by a family." The resident-decides rule would stay.

## 7. AI use disclosure

AI coding assistants were used heavily to build FixList. With Claude Code, Anthropic's Claude Opus 5.5 was used for design specs, review, integration and some code. Claude Sonnet 5.5 was used for documentation drafts. With OpenAI Codex, GPT-6.1 Sol wrote most of the implementation code. That includes the scan-suggestion pipeline, the roles and permissions logic, the phone screens and the Spanish text. GPT-6 Luna collected license-clear evaluation photos and labelled them with AI. GPT-6 Astra did reviews.

The Spanish text is machine-translated and has not been reviewed by a person.

Inside the app, a Mac-local AI model answers narrow photo questions about room-scan frames. It is a vision-language model, StartLux-Decision v1.1 9B (4-bit MLX), run on the developer's Mac. Its weights are licensed CC BY-NC 4.0, which is non-commercial. Its output is shown as unverified "areas to review" and never answers the checklist. Its score calibration was fitted on 125 AI-labelled public photos. It has not been shown to work in real homes.

The demo video narration uses a synthesized voice (Kokoro-82M, open source).

[REQUIRED — Andrew: 2–4 sentences on what you personally designed, decided, wrote and tested, in your own words.]

## 8. Tools and languages

**Languages:** TypeScript, JavaScript, Swift, Python, CSS, HTML

**App:** React 19, Vite, Capacitor 8 (iOS), ARKit (Swift plugin), three.js + Spark (Gaussian-splat rendering), Vitest

**Mac pipeline:** Python, ffmpeg, COLMAP/pycolmap, ALIKED + LightGlue, Brush, MLX (StartLux-Decision model)

**Content:** CDC "Check for Safety" checklist (paraphrased, cited); Eldercare Locator (real resource, Administration for Community Living)

**Fonts:** Atkinson Hyperlegible, Zilla Slab (SIL OFL)

## 9. Video title and description

(see final version)
