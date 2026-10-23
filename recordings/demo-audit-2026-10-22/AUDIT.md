# FixList demo-readiness audit — 2026-10-22

**Setup.** iPhone 17 Pro Simulator (iOS 26.5), UDID 133B41A2…; build `/tmp/fixlist-demo-build/…/App.app` (not rebuilt). Clean install, then the full journey driven with agent-device. No source files were edited. At the end the app was reset (More → Reset demo) and left on the language picker. `204` comes from a short re-run after the first reset, also followed by a reset.

**Caveat about automation.** Taps were sent as XCTest coordinate taps. Two unexpected jumps to "Who is using FixList?" (`150`, the first Alex "Continue") happened because the target button was scrolled under the sticky header, so the tap landed on the person chip. These are artifacts of the automation, not app bugs. Retrying in view worked (`157`). Dark-on-dark chips/buttons seen after scrolling are a real WebKit sticky-`:hover` effect (see D1).

## Screenshot index

| File | Screen | What it shows |
| --- | --- | --- |
| 010-language | Start | Language picker (English / Español), demo-profile banner |
| 020-person-picker | Start | Margaret, Sam, Alex, Jordan, "Create a demo profile" |
| 030–034-guide-1…4 | First-run guide | 4 steps: list/choices, one room at a time, choose what to fix, ask for help; "Next" turns lighter after a tap (sticky hover) |
| 040-home / 041-home-lower | Margaret Home | "Your next step: Continue your home check"; status cards; person chip dark-on-dark after scroll |
| 050–053-check… | Check | Progress text, room cards alternating with "Walk-through and photos" cards |
| 060-q1-rug, 061-q1-yes | Q1 | Rug question, Yes selected, "Recorded by Margaret (resident)" |
| 062/063-q1-lower/bottom | Q1 lower | Confirm explanation, "Confirm this is something to fix" (wraps "fix" onto line 2), photo buttons, metadata copy |
| 070-plan-before-confirm | Plan | Rug card with confirm prompt + "Nothing confirmed yet. An empty plan does not certify safety…" |
| 071-confirm-step / 072 | Plan | Rug moved to "Quick fix" with "Explicitly confirmed" tag, CDC source, Remove confirmation / Ask for help |
| 073-source-detail | CDC link | Tapping "Based on CDC 2017 Check for Safety" leaves the app for Safari (CDC PDF) |
| 074-after-cdc-link | Plan | Back in app; status bar now permanently shows "◀ Safari" |
| 082–089 | Q2–Q8 | Mixed answers (No, Not sure, Yes, No, Yes, Not sure, Yes); final button labelled just "Plan" |
| 090-plan-pending | Plan | Two unconfirmed Yes answers shown as cards above the plan, each with the same long helper sentence |
| 091–096-plan-grouped | Plan | Quick fix / Helper task / Needs a professional; "Start a professional-help record" |
| 100–102-walkthrough… | Room walk-through | Simulator fallback: "Room photo tour", Photo 1 of 2, **raw `Choose File / no file selected` inputs** |
| 103–105 | iOS picker | Photo Library / Choose File menu, system photo picker |
| 106/107-photo-added | Photo tour | Photo preview, "1 photos ready to save" |
| 108–110-walkthrough-saved… | Saved walk-through | "Saved 10/22/2026 · 1 photos", "No room outline. Photos only." twice, raw file input for "Add AI review results" |
| 120/121-more | More | Room scan, Family helper access, Report, Language, About, "Navigation layout (prototype)", Reset |
| 130–133-scan… | Room scan (empty) | Two screens of file-format text before the demo-scan buttons |
| 140–147-scan… | Room scan loaded | viennese-v2 metadata, flip-upright toggle, model ID string, stacked arrow buttons, "131,386 splats loaded", AI suggestion card + frame, Show in 3D/Add as pin/Dismiss, Below threshold (4), Not visible (3), Room pins (0/200) |
| 150-show-in-3d-first-tap | Picker | Automation artifact: tap hit the sticky person chip |
| 152, 155, 155b | Reopen | Saved scan reloaded after relaunch; "Open saved room viewer"; scan renders |
| 156–158-show3d | Show in 3D | Camera flies to a blurry close-up of a doorway |
| 160–162-generated-room | Generated room | Replaced viennese-v2 without a confirmation; simple box room renders |
| 165–167-scan-load-t… | Load timing | Load button tapped; state updates in under 0.2 s, but the viewer is off-screen |
| 168-scan-rendered-after-scroll | Viewer | WebGL splat renders immediately after scrolling (~8 s after tap, mostly scroll time) |
| 169-scan-after-orbit-drag | Viewer | A short drag orbits into a grey, foggy smear |
| 200–203-sharing… | Choose what to share | Checkbox cards, filled preferred time and area |
| 204-keyboard-header-overlap | Choose what to share (re-run) | Keyboard open: header "Back"/"Help" overlap the clock; tab bar floats above the keyboard bar; "Home" tab highlighted |
| 210-invite | Choose a volunteer | Alex card "Self-reported, not verified" |
| 211–213-invite-confirm | Review invitation | Shared / Not shared table, Invite Alex |
| 220–223-request… | Help request (Margaret) | "Invited", verification note, revoke buttons, timeline, cancel buttons |
| 230-switch-person | Picker | Switch person |
| 240–242-alex-home | Alex | Alex's 4-step guide on first switch; Home with invitation; Task boundaries |
| 243–245-alex-… | Alex task | Shared details only; Accept; "Your proposed time" → "Saturday 10 am" |
| 250–252-margaret-… | Margaret | Next step "Review a proposed visit time"; Agree; "Visit agreed" |
| 260–264-alex-… | Alex | "Share your progress"; empty "Invitations" heading; update posted; Report done → "Volunteer reported done" |
| 270–274-margaret-… | Margaret | "Review a completion report"; "Yes, it's done" → "Resident confirmed done · This episode is complete…" |
| 280-help-tab / 281-requests-list | Help | Help tab (Replay guide, Find local help); requests list |
| 290/291-sam… | Sam (default) | Sam's guide; Home says "Margaret has not shared this part of FixList with you"; Check/Plan disabled |
| 292–294-family-access… | Margaret | Family helper access checkboxes, Save permissions |
| 295–297-sam… | Sam (granted) | "Acting for Margaret", Home, Plan with "View help request" |
| 300–304-resources… | Find local help | Eldercare Locator (real, source verified 2026-10-18), default fictional profile "all facts unknown" → wall of "Unknown / not supplied" |
| 305–308 | Find local help | Profile picker; Maple homeowner → "Condition met" rows ("expected equal to "maple"") |
| 320–327-report… | Printable report | Report sections, coverage bar, answers, action plan with "Scripted sample observation", screening, footer |
| 330-print-sheet | iOS print | Native print options, "Pages 1-13" preview (then closed) |
| 400–404 | Language / Spanish | Language page; Spanish banner "Traducción automática; aún no revisada…"; Inicio; Plan in Spanish |
| 410-about | About | Disclaimer-only text |
| 420/421-dynamic-type… | AX Large text | Tab labels break mid-word ("Hom e", "Chec k") |
| 430–432 | Reset | Reset dialog (top overlaps the status bar), then back to language picker |
| 440-header-help | Start | Header "Help" tip; Help button stuck dark with unreadable label |

## Defects and polish

Severity: **blocker** = breaks or misleads the core video journey; **ugly-on-video** = visible and noticeable on camera; **minor** = polish or off-path.

### Visual / behaviour

| # | Screen | Observed | Severity | Suggested fix |
| --- | --- | --- | --- | --- |
| D1 | Every screen (person chip, Help button, Next/Continue) | After a tap or scroll, the element under the last touch point keeps `:hover`: the person chip becomes dark green with dark text (`041`, `051`, `142`…); header Help becomes an unreadable dark block (`440`); a new screen's "Continue" under the previous tap point looks disabled (`260`); guide "Next" looks greyed (`032`). | **ugly-on-video** (appears on almost every scrolled frame) | Wrap hover rules in `@media (hover: hover) and (pointer: fine)`: `src/styles/base.css:50,81,84,94,152,167,238` and `room-sketch.css:15`. `.person-chip` (`phone.css:29`) also inherits the dark `button:hover` background without setting its own text colour. |
| D2 | Room photo tour / walk-through (`100`–`110`) | Unstyled native `Choose File` / `no file selected` inputs for "Take photo", "Choose photo" and "Add AI review results". Looks unfinished next to the styled buttons used on the Check screen. | **ugly-on-video** | Hide the inputs and trigger them from styled buttons, as `src/app/Photos.tsx:16-17` already does. Source: `src/app/CaptureScreens.tsx:83,189`. |
| D3 | Room scan (`130`–`147`) | The 3D viewer is about 2.5 screens down, under import limits, file-format rules, metadata, a flip toggle and a pin picker. Six full-width stacked buttons (← → ↑ ↓ + −) dominate the screen below the canvas. The viewer is small (about 390×240 pt). | **ugly-on-video** | For the demo build, put the viewer first. Collapse "Import a local scan" and the format text into a disclosure. Replace the arrow stack with a compact 2×3 grid or an overlay, or hide it behind "Keyboard/accessible controls". `src/app/ScanPanel.tsx`, `ScanViewer.tsx`. |
| D4 | Show in 3D (`157`/`158`) | The camera flies to a blurry close-up of a door edge. The suggestion frame (`146`) mostly shows a bedroom (bed, curtains); a tub or toilet is not obvious at phone size, but the card says "Model score 0.99". A short orbit drag also lands in grey fog (`169`). | **ugly-on-video** (it undercuts the AI segment) | Pull the "Show in 3D" viewpoint back, or use the frame's camera pose. Check `suggestions.json` for the viennese-v2 bathroom-support item; if the frame doesn't clearly show the fixture, skip this segment. Limit orbit radius and pitch. |
| D5 | CDC source link (`073`, `074`) | Opens Safari and leaves the app. Afterwards, every frame shows "◀ Safari" in the status bar until relaunch. | **ugly-on-video** if tapped on camera | Don't tap it on camera, or open it in-app (Capacitor Browser / SFSafariViewController). Relaunch the app before recording. |
| D6 | Choose what to share, typing (`204`) | With the keyboard open, the header slides up: "Back" and "Help" overlap the clock and Dynamic Island, and the tab bar rides up above the keyboard accessory bar. | **ugly-on-video** (the typing moment is in the shot list) | Use `env(safe-area-inset-top)` on the sticky header, or set Capacitor Keyboard `resize: 'native'`/`'body'`. See `src/styles/phone.css` and `capacitor.config.json`. |
| D7 | Sam default view (`291`) | Sam's first Home is a single note: "Margaret has not shared this part of FixList with you…". Check and Plan are greyed out. Sam's guide (`290`) still says "Record what you notice". | **ugly-on-video** if Sam is shown | Seed demo permissions for Sam in `src/data/demo-people.ts` / `demo-scenario.ts`, or record Margaret granting access first (`292`–`295` work well). |
| D8 | Find local help default (`301`–`304`) | Default profile "Fictional: all facts unknown" fills the screen with "Unknown / not supplied" tiles and "Unknown / unanswered" rows. | **ugly-on-video** | Default to "Fictional: Maple homeowner" for the demo (`src/data/fictional-profiles.ts`), or record only the Eldercare card and the program heading. |
| D9 | Volunteer Home (`260`) | "Invitations" heading with nothing under it, immediately followed by "My tasks". | minor | Hide empty sections or add "No new invitations." (`src/app/VolunteerScreens.tsx`). |
| D10 | Check question screens (`060`, `087`) | Only the question and Yes/No fit above the tab bar; "Not sure" is cut off. Every question needs 2–3 scrolls to reach "Next", and answering doesn't auto-advance. | ugly-on-video (slow) | Move "Next" directly under the options, or auto-advance after an answer. Move the photo and metadata text into a disclosure. |
| D11 | "Confirm this is something to fix" (`062`, `070`, `090`) | The button wraps with "fix" alone on line 2. | minor | Shorten the label to "Confirm: fix this" or "Add to my plan". `src/i18n/en.ts` (key near `check.confirm…`). |
| D12 | Generated sample room (`160`–`162`) | "Try a generated sample room" replaced the loaded viennese-v2 scan and its AI suggestions without asking. | minor (risky during rehearsal) | Confirm before replacing, or hide this button when a bundled demo scan exists. |
| D13 | Reset dialog (`431`) | Dialog top ("Reset demo") sits under the status bar / Dynamic Island. | minor | Add safe-area top margin to the dialog styles. |
| D14 | Dynamic Type AX Large (`420`) | Tab labels break mid-word: "Hom / e", "Chec / k". | minor (the shot list says not to claim Dynamic Type) | Use `word-break: keep-all; hyphens: none`, smaller label size, or icon-only tabs at AX sizes. |
| D15 | Alex/Sam first switch (`240`, `290`) | Each first switch shows a 4-step guide, which adds taps mid-video. | minor | Skip helper guides in the demo seed, or tap "Skip guide" off camera. |

### Developer jargon / internal terms visible to users

| # | Screen | Exact visible text | Severity | Fix (source) |
| --- | --- | --- | --- | --- |
| J1 | Room scan | "Import a local scan (up to 64 MiB and 1.5 million splats)"; "Supported: .splat and bounded scalar-vertex .ply. Compressed SPZ/KSPLAT and unsupported PLY variants are refused. Optional metadata must be named scene.json; optional model output must be named suggestions.json." | ugly-on-video | `src/i18n/en.ts:609-610` (`legacy.scanpanel.17/18`); collapse into "Import your own scan" + details. |
| J2 | Room scan | "scene.splat · 4.0 MiB · Pipeline metadata: y-up, arbitrary units"; "Flip upright (for upside-down app exports)"; "131,386 splats loaded."; "Room pins (0/200)"; "Load local demo scan: viennese-v2 (4.0 MiB)" | ugly-on-video | `en.ts:613,621,623,630,856`. Rename to "Sample apartment (from a public video)", hide file/size/axis lines and the pin limit. |
| J3 | Room scan | "Imported room — supplied by you, not assessed by FixList", shown for the **bundled** demo scan | ugly-on-video (inaccurate) | Use a separate label for bundled scans, e.g. "Demo room built from a public video — not assessed by FixList". |
| J4 | AI suggestions | "Model: StartLux-Decision-v1.1-9B-AutoThink-MLX-4bit · MLX · License: CC BY-NC 4.0 weights"; "Model score 0.99 (adjusted on 102 example photos labeled by AI; still experimental, not validated in real homes) · 2 of 60 frames above threshold"; "Location uncertainty was not recorded in this output…"; "Below threshold (4)"; "Not visible in analyzed frames (3)" | ugly-on-video | `en.ts:37,651`, `src/lib/scan-suggestions.ts:126`. Show "Experimental AI score: 0.99 — not a finding" and move the provenance into a details disclosure. |
| J5 | Report | "Scripted sample observation: a rug edge crosses the walkway." "Source: Authored fictional fixture for the FixList demo (synthetic)." "Synthetic; no verification date." | ugly-on-video (the report is on camera) | `en.ts:755,760-…`; e.g. "Sample note: a rug edge crosses the walkway (fictional)". |
| J6 | Find local help | "Fictional area is "maple"; expected equal to "maple". This condition is met." / "Fictional homeowner is true; expected equal to true." / "20000 USD/year" | ugly-on-video | `src/domain/fact-screening.ts:261,266`: render human sentences ("Lives in the Maple area ✓"), format numbers ($20,000/year). |
| J7 | Help request | "This episode is complete. New concerns need a new episode." | ugly-on-video (final shot of the journey) | `en.ts:192` → "This request is finished. Start a new request for anything else." |
| J8 | More | "Navigation layout (prototype)" with "Current: Home / Check / Plan / H…" (truncated select) | minor | Hide in the demo build (`en.ts:114`, More screen). |
| J9 | Plan | "Start a professional-help record" / "Update your professional-help record"; "An appropriately qualified professional" | minor | `en.ts:185,195` → "Note a professional to call". |
| J10 | Plan/report | "Explicitly confirmed" tag on every plan card; "Explicitly confirmed by Margaret…" | minor | Everything in the plan is confirmed already; drop the tag or use "Confirmed". `en.ts:309,574`. |

### Repetitive, hedged or legal-sounding copy

| # | Screen | Observed | Severity | Fix |
| --- | --- | --- | --- | --- |
| C1 | Plan before confirm (`090`) | Each unconfirmed card repeats "Only confirmed concerns enter your plan. Changing this answer to No or Not sure removes its confirmation." (also on every question). | ugly-on-video | Say it once at the top of the pending section; keep the card body to the button. `en.ts:311`. |
| C2 | All request screens, both roles | "Independent verification: Not available in this demo" as a callout on every request view. | minor | Show once in the timeline/footer. `en.ts:362`. |
| C3 | Room scan suggestions | Two adjacent disclaimers that say the same thing: "…Areas to review — not findings. They never answer or confirm the checklist." and "Model suggestions are areas to review, not findings. They never answer or confirm a checklist item." | ugly-on-video | Keep one. `en.ts:99`, `src/lib/scan-suggestions.ts:11`. |
| C4 | Question wording | "Is the sample shower surface described as slippery?", "Is support reported as missing where needed near the sample tub or toilet?", "Is a light or accessible switch missing for the sample stairs?" | ugly-on-video (rug Q is fine) | Plain questions: "Is the shower floor slippery?", "Is there a grab bar by the tub or toilet?" (`src/data/demo-scenario.ts:106,117`, `en.ts:488`). The "sample" prefix on every room is also heavy. |
| C5 | Progress text (Home/Check) | "0 of 8 answered (0 not sure); 8 not answered" | minor | "0 of 8 answered" + optional "2 not sure". `en.ts:279`. |
| C6 | Sharing / invite | "Shared evidence is available during the assignment. Completion ends evidence access; the task history remains." | minor | "Alex can see these until the job is done." |
| C7 | About (`410`) | The page is only disclaimers; it doesn't say what FixList is for, the version, or credits. | minor | Add the one-sentence purpose and credits (useful for the closing card). |
| C8 | Report (`320`, `327`) | Two disclaimer paragraphs at the top, more in each item, and a footer. Prints 13 pages. | minor | Fine for honesty, but show only the top of page 1 on camera. |
| C9 | Walk-through saved (`108`–`110`) | "Photos only", "No room outline. Photos only." twice, "Approximate room sketch. Not to scale for measuring." with no sketch. | minor | Show one line when there is no outline. `en.ts:25`. |

### Inconsistent naming

- Pluralisation: "1 photos ready to save" and "Saved 10/22/2026 · 1 photos" (`en.ts:15,73`). **minor**
- Attribution: "Recorded by Margaret (resident)", "Written by Alex", "Written by Alex (volunteer)", and on Alex's view both "Written by Alex" **and** "Recorded by Margaret" stacked under the agreed time (`261`). **minor**
- "Help" means two things: the header "Help" tip toggle and the "Help" tab page. **minor**
- On Margaret's request page, the section listing what's shared is titled "Choose what to share" again (`220`), though nothing is being chosen; "What Alex can see" would fit. **minor**
- The tab bar highlights "Home" on Choose what to share / Review invitation / Help request (`200`, `204`, `220`) even when reached from Plan. **minor**
- The last check question's button is just "Plan" (`089`); "See my plan" is clearer. **minor**

### Loads / performance

- Bundled scan `viennese-v2` (4.0 MiB, 131,386 splats): state updates in under 0.2 s (`165`). The WebGL splat was already rendered when scrolled into view (`168`, ~8 s after the tap, mostly my scroll commands). After relaunch, "Open saved room viewer" also rendered within a few seconds (`155b`). **WebGL renders in the Simulator.** No load failures.
- Print sheet opened within about 2 s with a 13-page preview.
- ARKit is unavailable in the Simulator, so it fell back to the guided photo tour as expected.

## Core video journey: taps and time

The shot-list path from a clean install (language → Margaret → rug Yes → empty plan → confirm → ask for help → share → invite Alex → Alex accepts/proposes → Margaret agrees → Alex updates/done → Margaret confirms → report/print → resources → Spanish):

- **About 45 taps, 12–15 scrolls and 2 text entries** if the guides are skipped (+3 for Alex's guide on first switch). It took 7 role switches of 2 taps each.
- At a natural 1.5–2 s per action, the interaction alone is about **2:00–2:30**, before narration pauses. Combined with the 0:16 title and the closing card, this exceeds the shot list's 2:25 estimate unless taps are trimmed. Suggested trims: skip the guides off camera; skip the preferred-time and area text entry; use "Your next step → Continue" on every Home (it goes straight to the right request); cut from Margaret confirming the rug to the plan instead of scrolling.

**Most impressive on camera**
1. Role switching while the status pill advances: "Invited → Accepted → Visit agreed → Volunteer reported done → Resident confirmed done" (`220`, `251`, `252`, `264`, `274`), with Home's dark "Your next step" card changing per person.
2. The 3D splat render of viennese-v2 (`168`), and the AI frame shown next to the suggestion (`146`), if the frame is convincing.
3. Choose-what-to-share → Review invitation → Alex sees only the shared fields (`213` vs `243`).
4. Instant Spanish switch with the translation banner (`402`/`403`).
5. Native iOS print preview (`330`).

**Most boring / risky on camera**
1. The 8-question check: one question per screen, 2–3 scrolls each, small helper text (`060`–`089`). Show only the rug question.
2. Room scan screen before the viewer: file-format text, model ID string, the arrow-button stack (`131`–`145`).
3. Find local help fictional criteria rows (`304`–`308`).
4. Scrolling through the report body (`321`–`327`).
5. "Show in 3D" landing on a blurry door edge (`157`).
