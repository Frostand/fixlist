# FixList UI, navigation and setup redesign brief (2026-10-23)

The owner reviewed the app and said: "the app is still shit. ui sucks, navigation sucks, the setup guide sucks and isnt clear at all." The app is a Congressional App Challenge entry due Mon 2026-10-26 at noon EDT. It ships as a Capacitor iOS app, and the demo video is recorded on an iPhone 17 (402×874 CSS px viewport). This brief replaces the visual system, information architecture, onboarding and the copy tone. Domain logic, storage and the honesty invariants stay as they are.

## What is wrong today (observed at 402×874)

- It reads like a legal web page, not an iPhone app. Every screen opens with a disclaimer or engineering status ("Saved on this device", "Older saved data was migrated in memory… Saved bytes remain unchanged until an explicit edit", "Grouped by who can usually do it — a reading aid, not a risk ranking"). Underlined prose links, slab-serif headings and bordered full-width buttons are everywhere.
- The core feature is buried. Room scanning is a flat "Walk-through and photos" row repeated under every room on the Check tab, misaligned with the bordered room cards. "Room in 3D" hides under More. Home never mentions scanning.
- The five tabs (Home, Check, Plan, Help, More) do not match the job. Help is a paragraph of text. More is a flat list of 8 buttons, and switching person is a chip under the wordmark.
- The setup guide is four text cards ("Your list, your choices"…). It never shows what the app does (scan a room → review flagged spots → fix list → ask for help), never mentions the camera or privacy, and doesn't tell people what to do first.
- Local help shows 7 "Fictional:" profile buttons and an exhaustive criteria table inline.

## Target feel

A calm, confident, native-feeling iOS app for older adults and their families. Big type, few words, one clear primary action per screen, and generous tap targets. It should look like it belongs next to Apple Health or Settings, with its own warm accent. Use plain, warm language at roughly a 6th-grade reading level.

### Visual system (replace tokens in `src/styles/base.css` and `phone.css`; keep the variable-based approach)

- **Font:** the system UI stack only: `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif`. It renders every script (CJK, Vietnamese, Arabic, Cyrillic). Remove the Zilla Slab and Atkinson imports from the CSS/entry. Leave `package.json` and the lockfile untouched; unused packages are fine.
- **Type scale:**
  - Large title: 34/41, weight 700, letter-spacing −0.02em.
  - Title: 22/28, weight 700.
  - Headline: 17/22, weight 600.
  - Body: 17/24.
  - Subhead/secondary: 15/20.
  - Footnote: 13/18.
  - Section headers in grouped lists: 13px, uppercase, secondary color, tracking 0.02em.
  - Respect the existing text-size setting (Access screen) by scaling the root.
- **Color:**
  - Background `#F2F2F7` (grouped). Surface `#FFFFFF`.
  - Label `#1C1C1E`. Secondary label `#5F6368` (must reach ≥4.5:1 on both background and surface). Separator `rgba(60,60,67,0.18)`.
  - Primary/accent: deep green `#0B5D4B`, pressed `#084638`, wash `#E3F1EC`.
  - Brand highlight: amber `#D97706`, from the app icon (wordmark dot, illustrations).
  - "Spot to review" (AI flag): amber wash `#FFF4DB` with `#8A4B00` text and an amber marker.
  - Confirmed concern: keep the existing caution-yellow meaning.
  - Success `#1E7B34`. Destructive `#C62828`. Focus ring `#1D5FD1`.
  - Use hatching only where it already means "unknown"; never as decoration.
- **Shape and spacing:**
  - Cards and inset lists use 16px radius, buttons 14px, chips/pills 999px.
  - Page gutter 16px; 24–28px between sections.
  - Primary buttons: 52px tall, filled accent, white 17px semibold. Secondary: tinted (accent wash bg, accent text). Tertiary: plain accent text.
  - Minimum tap target 44×44. Elevation is a very soft single shadow or none; separation comes mostly from the white-on-gray contrast.
- **Components to standardize (small React components, then reuse everywhere):**
  - `ListGroup` / `ListRow`: icon tile (28px rounded square with tinted background) + title + optional subtitle + optional trailing value/badge + chevron. Rows are separated by an inset hairline, like iOS inset grouped lists.
  - `Card`, `PrimaryButton` / `SecondaryButton`, `SegmentedControl` (Yes / No / Not sure; Plan / 3D), `StatusPill`, `ProgressRing` or bar, `EmptyState` (icon + title + one line + action), `Sheet`/modal for confirmations, `IconTile`.
  - Extend the `Icon` set in `PhoneShell.tsx` with consistent 24px stroke icons: scan/camera (ARKit), room, flag, list-check, hands/help, gear, globe, text-size, printer, cube (3D), shield/lock (privacy), person, people, phone, chevron, plus, info, trash, check-circle.
- **Navigation chrome:**
  - Tab roots use a large-title header: the title on the left and a 36px avatar button (person initial) at the top right, which opens Profile & settings.
  - Pushed screens use a compact bar: a back chevron with the parent's name, a centred 17px semibold title, and an optional trailing action.
  - Bottom tab bar: translucent white (`backdrop-filter: blur(20px)` with a solid fallback), hairline top border, icon above a 11–12px label. The active tab uses the accent color and a filled icon variant if cheap. Respect `env(safe-area-inset-*)`.
  - Use CSS logical properties (`margin-inline`, `padding-inline-start`, `inset-inline-end`, `text-align: start`) throughout. A parallel workstream is adding Arabic (RTL) and many other languages, and long translations must wrap rather than overflow.

## Information architecture

Make one layout the only resident layout. The `?nav=` layout comparison and the `current`/`three`/`four` switching become unnecessary. Remove them or collapse them to the single layout, and update the tests and `navigation-layouts.ts` accordingly. Keep route hashes stable where possible (`#/r/home`, `#/r/check`, `#/r/plan`, `#/r/requests`, `#/r/room/<id>`, `#/r/capture/<id>`, `#/r/question/<id>`, …), because the video tooling and tests rely on hash routes.

**Resident and family-helper tabs (4):**

1. **Home** (`home`):
   - Greeting ("Hi, Margaret") and a home-progress card: rooms scanned X of N, a ring or bar, plus three compact stats (spots to review · fixes planned · help requests).
   - A **hero card "Scan a room"** (scan icon; "Takes about 2 minutes. Your phone maps the floor and takes guided photos.") with a primary button. It goes to the next unscanned room's capture intro, or to Rooms when all are scanned.
   - A "Next step" card driven by the existing `elderNextStep` / `helperNextStep` logic.
   - "Updates" from volunteers.
   - Family helper home: the same structure, with "Acting for Margaret" shown as a subtle pill under the title (not a banner) and helper wording.
2. **Rooms** (`check`, tab label "Rooms"):
   - Large title "Rooms". One line: "Scan each room, then answer a few quick questions."
   - One inset list with one row per room. Each row shows a thumbnail (the first capture photo if one exists, otherwise a room icon tile), the room name, and a status ("Not scanned yet" / "Scanned · 2 spots to review" / "All questions answered"), plus a chevron to the room page.
   - Below the list, a secondary "Answer questions one by one" that keeps the existing sequential question flow.
   - No separate "Walk-through and photos" rows.
3. **Fix list** (`plan`):
   - Large title "Fix list" with a summary line ("3 fixes · 1 in progress").
   - Grouped inset lists using the existing grouping ("You can do it", "Ask family or a volunteer", "Needs a professional", or the current group keys), with friendly section headers.
   - Rows show the fix title, the room, and a status pill. Tapping a row opens the detail and "Ask for help".
   - Empty state: an illustration icon, "Nothing to fix yet", "Scan a room or answer questions. Fixes you confirm show up here.", and a [Scan a room] button.
   - The "reading aid, not a risk ranking" and "does not certify safety" notes go in one small footnote at the bottom.
4. **Help** (`requests`, tab label "Help"):
   - Primary "Ask for help" (the existing request creation entry).
   - "Your requests" list with status pills.
   - "Local services": an Eldercare Locator card with a Call button and a website link.
   - "Example programs": a single row that opens the fictional programs screen (keep "fictional" labelling there, collapse the 7 profile buttons into a picker or segmented sheet, and put the criteria table behind "See details").
   - "How FixList works" opens the replay guide.
   - The old `help` screen's text and the per-screen "Tips" button can go. If a contextual tip is kept, make it a small (i) button that opens a sheet.

**Profile & settings** (`more`, opened from the avatar on any tab root; title "Profile & settings"). An inset grouped list:

- Person row: avatar, name and role, with "Switch person".
- Language (shows the current language's native name).
- Text size & display (access).
- Family helper access (sharing / delegation).
- Printable report.
- Sample 3D room (`scan`).
- How FixList works (replay guide).
- About & privacy.
- Reset FixList (destructive red, with a confirmation sheet).

Show the demo note ("Fictional household · demo profiles on this device · no real accounts") here and in About, not on every start screen.

**Volunteer** keeps Home / Tasks / Profile, restyled with the same components.

## Room page and scanning (`room/<id>` and `capture/<id>`)

The room page is where scanning lives. It should be the best-looking screen in the app.

- **Not scanned:**
  - A large illustration (inline SVG: a phone over a floor outline, using the accent and amber colors).
  - The title "Scan the living room".
  - Three numbered tips, each with an icon:
    1. "Stand in the doorway and point your phone at the floor."
    2. "Tap each corner of the floor, then tap Done."
    3. "Take the photos FixList asks for."
  - A primary [Start scan] button and the line "Photos stay on this phone."
  - If ARKit is unavailable (the browser or Simulator, via `captureAvailability()`), the primary button becomes [Take photos instead], with one line explaining that the camera tour works without AR.
- **Scanned:**
  - A hero with the room sketch (`RoomSketch`) inside a card, with a Plan / 3D `SegmentedControl` when an outline exists. Flag markers are amber.
  - A **"Spots to review"** section of flag cards: the photo thumbnail with the marker, a short human title (the checklist item's short label, e.g. "Rug edge", "Loose cord", "Stair clutter"), and one line of what to check (the limitation or guidance).
  - Each flag card has a small chip "AI suggestion · may be wrong", an expandable "What the AI checked" that shows the exact photo question and the score text (this keeps the AGENTS.md labelling rule while staying compact), and two buttons: [It's a problem] (the existing review/add action) and [Looks fine] (the existing `notProblem` action).
  - Keep the existing helper-proposal wording for family helpers.
  - When there are no flags: "No spots flagged. AI can miss things, so answer the questions below too."
  - **"Questions for this room":** each checklist item for the room inline, with a Yes / No / Not sure `SegmentedControl` dispatching the existing `answer_checklist` command, plus a link to the full question screen (photos, confirm). Confirmation stays separate and explicit, as today.
  - **"Scan again"** and **"Delete scan"** (confirmation sheet).
  - An **"Advanced: deeper review on a computer"** disclosure that holds the existing export-bundle / import-flags controls and their privacy text.
- `capture/<id>` (CaptureFlow) is the scan intro and runner. Restyle it to match. Don't change the native plugin contract. A separate workstream is changing `ios/` and `src/lib/native-capture.ts`, `capture-suggestions.ts` and `capture-types.ts` to add on-device flags right after capture. Do not edit those lib files; only consume `record.flags` / `displayFlags()` as today. If you need a new display field, read it defensively.

## Setup guide (first launch: `start` → `people` → `guide`)

Rebuild it as a clear, visual 4-step setup with a progress indicator ("Step 1 of 4" plus dots), Back, and a skip option where appropriate:

1. **Welcome and language:**
   - App icon (amber rounded square with "F", inline SVG), "FixList", and the tagline "Find and fix trip and fall risks at home, room by room."
   - The language list, one big row per language in its native name, with a checkmark on the selected one. Render it from a list exported by `src/i18n`. Today that is English and Español; a parallel workstream will add more, so don't hard-code two buttons.
   - [Continue].
2. **Who's using FixList?** Three role cards, each with an icon and one line:
   - "I live here" → Margaret.
   - "I'm helping a family member" → Sam.
   - "I volunteer" → Alex / Jordan.
   - Keep "Create a demo profile" as a tertiary link.
   - Footnote: "Demo profiles on this device. No account needed."
3. **How it works:** three swipeable/next-able illustrated panels, each with a big inline-SVG illustration, a 1-line title and a 1–2 line body. They are role-specific.
   - Resident and helper:
     - "Scan a room": "Walk through with your phone. FixList maps the floor and takes guided photos."
     - "Review flagged spots": "On-device AI points out spots worth a closer look, like a rug edge or a loose cord. You decide what's a problem."
     - "Fix it, or ask for help": "Easy fixes come first. Share a task with family or a volunteer when you want a hand."
   - Volunteer:
     - "See what's shared with you"
     - "Agree on a time"
     - "Report when it's done"
4. **Your home stays on your phone:** a lock/shield illustration and three short checkmarked lines:
   - "Photos and answers are saved only on this device."
   - "Nothing is uploaded."
   - "Erase everything anytime in Settings."
   - A primary button: [Scan my first room] for resident and helper (it goes to the first room's scan intro), or [Get started] for volunteers. A secondary button, [Go to Home], appears for resident and helper.

Keep the existing guide-progress / dismissal persistence semantics (`guideProgress`, guide completed / dismissed), and the "replay guide" entry from settings and Help.

## Copy rules

- Rewrite `src/i18n/en.ts` copy for every screen you touch: short, plain, warm, active voice. No "demo bytes", "migrated in memory", "certify", or "reading aid" in primary copy.
- Keep exactly one small footnote where an honesty note is required:
  - AI suggestions are "AI suggestion · may be wrong. You decide."
  - Fictional programs are labelled fictional.
  - The plan does not mean the home is safe.
  - A Yes answer is separate from confirming.
- Keep Spanish (`es.ts`) complete and in sync for every key you add or change. It must stay a full `Record` of the English keys, and the typecheck enforces this. Natural Latin-American Spanish.
- The live "Saved on this device" status stays as a visually hidden live region, or a brief toast after a change. Never show it as a permanent line on every screen.
- The migration/recovery notice for old saved data becomes a compact dismissible banner ("We updated your saved data." + "Details") that keeps its export/refresh/reset actions behind "Details".

## Invariants that must not change

Read `AGENTS.md` (Constraints). In particular:

- Only confirmed concerns enter the plan.
- AI flags never answer, confirm or pre-fill a checklist item by themselves. Buttons the person presses may dispatch the same commands as today.
- AI flags are always labelled as unverified AI output, and the exact photo question stays reachable from the flag.
- Volunteers see only what is shared.
- Fictional programs say they are fictional.
- Nothing is uploaded. Reset still clears everything FixList owns.
- Print uses native printing (`PrintReport` must still render correctly; restyle lightly to match and check that print CSS still hides the app chrome).
- Keyboard and focus management keeps working: the skip link, focus moving to the screen heading on navigation, and Escape closing sheets.

## Out of scope

`ios/` native code; `src/lib/native-capture.ts`, `capture-suggestions.ts`, `capture-types.ts`, `capture-model.ts` (another workstream owns them); domain rules in `src/domain/*` except trivial display helpers; adding new languages (another workstream; just render the language list from a single exported array); `package.json` dependencies; `scan/`; `scripts/promo/`.
