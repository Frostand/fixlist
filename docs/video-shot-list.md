
# FixList demo video: shot list (target 2:45, hard limit 3:00)

This replaces the earlier plan. It covers the current iOS app (Capacitor build in the iPhone 17 Pro Simulator or on a phone). No final video has been recorded. CAC rules: 1 to 3 minutes, public on YouTube or Vimeo, deadline 12:00 pm EDT Monday October 26, 2026. Confirm against the [2026 official rules](https://www.congressionalappchallenge.us/wp-content/uploads/2026/05/2026-CAC-Rules.pdf).

**The video must show:** each participant's name, the app name, the purpose in one clear sentence, the target audience, the tools and coding languages used, and a showcase of functionality. Narration below is a draft for Andrew to rewrite in your own words.

## Shot list

| Time | On screen | Draft narration | Honesty notes |
| --- | --- | --- | --- |
| 0:00–0:16 | Title card: FixList. Names: **TODO participant names**. One-line audience and tools list. | "I'm [TODO name]. This is FixList. FixList helps older adults check their home for fall risks, decide what to fix, and ask family or volunteers for help. It's for older adults living at home, their family helpers, and volunteers. It's built with React, TypeScript and Vite, packaged for iPhone with Capacitor." | Edit the purpose sentence so it is one sentence you believe. No outcome claim (not "prevents falls"). |
| 0:16–0:22 | Language picker, then "Who is using FixList?" Tap Margaret. | "Everyone picks a language, then who they are. These are demo profiles on one phone." | Banner "Demo profiles on this device" should be visible. No real accounts or sign-in. |
| 0:22–0:38 | Check your home: one question per screen, answer **Yes** to the rug. | "Margaret answers one question at a time. Yes, there's a loose rug." | Fictional household. Saving a Yes puts nothing in the plan. |
| 0:38–0:52 | Show the plan still empty. Confirm the concern. Open the plan, grouped by who can do it, and one CDC-based next step. | "A Yes isn't enough. Margaret confirms it, and only then does it enter the plan. The plan is grouped by who can do each job, with a next step based on the CDC checklist." | Grouping is a reading aid, not a risk ranking. Do not say it finds every hazard. |
| 0:52–1:08 | Ask for help. Choose what to share. Invite Alex. | "Margaret asks for help and chooses exactly what to share. Then Margaret invites Alex, a volunteer." | Professional-review jobs (e.g. grab bars) cannot go to volunteers; mention only if shown. |
| 1:08–1:28 | Tap Switch person, then Alex. Alex accepts and proposes a time. Switch to Margaret, who agrees. | "Alex sees only what Margaret shared. Alex accepts and proposes a time. Margaret agrees." | Volunteer skills are labeled "Self-reported, not verified". Nobody is called vetted. |
| 1:28–1:46 | Alex posts an update and reports it done. Switch to Margaret: "Yes, it's done". | "Alex posts an update and reports the job done. Margaret confirms it. Completion is reported by people, not independently verified." | Matches the state "Resident confirmed done". No real visit or repair happened. |
| 1:46–1:56 | Printable report; open the iOS print sheet. | "FixList makes a printable report with what was answered, confirmed and done." | The native iOS print sheet was verified in the iPhone 17 Pro Simulator on 2026-10-18 (commit 5160f50); check it again on the recording device. |
| 1:56–2:16 | **Optional.** Room scan orbiting, then the model's "areas to review", then **Show in 3D**. | "We turned a walk-through video into a 3D model on a Mac. A local AI model scores a few photo questions and marks areas to review. These are experimental scores, not findings. It can be wrong, and Margaret decides." | Use on-screen wording only: "areas to review", "experimental model score", "not a finding". Never say "detects hazards". Scan is a render of a fictional apartment, units arbitrary, no measurements. |
| 2:16–2:24 | Find local help: Eldercare Locator, then the fictional programs. | "Find local help lists a real resource, the Eldercare Locator. The two example programs are fictional and say so." | Check the source line and verified date on screen (**TODO**). A match is not approval or funding. |
| 2:24–2:32 | Switch to Spanish briefly. | "FixList also works in Spanish. That text is machine-translated and hasn't been reviewed by a person yet." | Banner "Traducción automática; aún no revisada…" must be visible. |
| 2:32–2:45 | Closing card with the 2.0 plan and credits (below). | "Next, FixList 2.0 would add real accounts, server-checked permissions, and a partner volunteer organization. None of that exists yet. AI tools helped build this app; the full disclosure is in my submission." | Say what exists and what does not. **TODO Andrew: add one line on what you built yourself.** |

Without the optional scan segment the video runs about 2:25. Do not add time beyond 3:00 for extra scenes.

## Credits card (show 8 seconds or more)

- App: FixList. Participants: **TODO names**.
- Tools: React 19, TypeScript, Vite, Capacitor, three.js, Spark; Python, ffmpeg, COLMAP (pycolmap), Brush; StartLux-Decision model (weights CC BY-NC 4.0).
- AI assistance in development: Claude (Opus 5.5, Sonnet 5.5) and OpenAI Codex models (GPT-6.1 Sol, GPT-6 Luna); see the submission's AI disclosure.
- Next steps text based on the CDC "Check for Safety" checklist. Eldercare Locator: Administration for Community Living.
- Fonts: Atkinson Hyperlegible, Zilla Slab (SIL OFL).
- If the scan is shown: *Source footage: "UE4Arch.com – Viennese apartment" by UE4Arch.com, Wikimedia Commons, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/), https://commons.wikimedia.org/wiki/File:UE4Arch.com_-_Viennese_apartment.webm. Trimmed to 58–158 s, frame-sampled and reconstructed into a 3D scan; changes were made.*

## Do not show

- The playroom scan (Inria/Deep Blending research data, license not established).
- Evaluation photos or the private manifest.
- Any real name, address, phone number, face, real home photo or private message. Use only Margaret, Sam and Alex.
- The Mac desktop, notifications, file paths, browser tabs or account names.
- Any claim that the app is validated, found hazards, certifies a home, or contacted a real person.

## Pre-recording checklist

- [ ] Run `npm test`, `npm run typecheck`, `npm run build`; record the results.
- [ ] Run `npm run ios:demo` so the app bundles `viennese-v2`.
- [ ] Use the iPhone 17 Pro Simulator (or a phone). Note the device and iOS version.
- [ ] Reset the demo to a clean state and rehearse the whole journey twice from the picker.
- [ ] Set the text size to a readable default; no Dynamic Type or VoiceOver claims.
- [ ] Confirm `suggestions.json` is in the bundled `viennese-v2` scan and that the screen shows only what the file contains. Do not script which items appear. The v2 file was regenerated on 2026-10-18 with the adopted calibration (60 frames; only bathroom support is suggested, at an adjusted score of 0.99; rug and night lighting fell below the threshold).
- [ ] Confirm the print sheet opens on the recording device.
- [ ] Turn on Do Not Disturb and hide notifications. Airplane mode is not required.
- [ ] Review the full frame and audio for private data before upload (`recordings/README.md`).
- [ ] Time the final cut at 3:00 or less. Upload as public on YouTube or Vimeo, and open it logged out.
- [ ] Keep raw captures out of Git. Uploading is a separate step that needs Andrew's decision.
