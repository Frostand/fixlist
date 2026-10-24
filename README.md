# FixList

FixList is a prototype for older adults and their families who want help with household jobs from volunteers. An older adult describes a job, a volunteer accepts it, and the two follow it through progress and confirmation. The local demo walks through that whole cycle with fictional people on one device.

## What it does

- **Two roles.** An older adult/requester posts and tracks jobs. A volunteer browses nearby jobs, accepts one, updates progress, and messages the requester. After the requester confirms, the volunteer earns service credit.
- **Demo profiles.** The demo has filled elder and volunteer profiles with sample jobs, plus a blank elder profile and a blank volunteer profile to start from scratch. All people, homes, and addresses are fictional, and all data stays on the device.
- **Writing help.** In a browser, a rules-and-templates helper turns a typed description into a draft request (voice input needs the iPhone app). The person reviews it before posting.
- **Room capture (compatible iPhone only).** ARKit guides room photos and an outline. You can add a silent video of up to 30 seconds. Photos and outlines are exported or shared only when you choose to. Video stays on the device, and AI suggestions use the photos only.
- **On-device AI (iPhone only).** Apple's native FoundationModels writing helper needs a supported iOS 26+ device with the model and language available. A rules helper supports other configurations; failed native requests never switch to a cloud service.
- **Map.** Volunteers see jobs on an OpenStreetMap map.

## Stack

React, TypeScript, Vite, Capacitor, Swift, ARKit, Core ML, Leaflet, Three.js/Spark, Supabase (optional real-account backend), and Vitest. The demo needs no API keys or paid services.

## Run it

Requires Node 24.18 or newer within 24.x, and npm 11.

```sh
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/Frostand/fixlist.git
cd fixlist
npm run setup
npm run dev
```

Open <http://127.0.0.1:5173> and choose **Explore local demos**. `GIT_LFS_SKIP_SMUDGE=1` skips the large iPhone model weights, which the web demo doesn't need.

## Submission build

The submission build is demo-first and local-only. It ignores environment variables and Supabase configuration, so it has no real sign-up or sign-in and no provider controls. Everything in it is fictional and stays on the device. Asset paths are relative, so the output can be served from any folder.

```sh
npm run build:submission    # writes dist-submission/
npm run preview:submission  # serves it at http://127.0.0.1:4173
```

`npm run build` is the ordinary build. It reads `.env.local` and opens the real-account entry when Supabase is configured.

## Tests

```sh
npm run typecheck
npm test
npm run test:db    # database migrations, in-memory PostgreSQL, no Docker
```

## Optional iPhone app

You need a Mac with full Xcode (opened once to finish setup) and [Git LFS](https://git-lfs.com).

```sh
npm run setup -- --ios    # also downloads the ~181 MB Core ML model weights
npm run ios:submission   # verifies the model and syncs the submission demo to Xcode
npx cap open ios
```

Choose your signing team and device in Xcode, then run. Capture and voice need a physical iPhone with the right hardware and permissions. A Simulator run doesn't exercise them.

Use `npm run ios:sync` instead to sync the ordinary real-account build.

## Real accounts (optional)

The ordinary build can use Supabase Auth with a small closed-pilot workflow. A real account that the project owner has manually approved can post requests, accept jobs, message, confirm, rate, and view approved service credit, all through row-level-security-protected database functions. Setup is in the [Supabase setup guide](docs/supabase-auth-setup.md). It isn't needed for the demo or the submission build.

## Limits

- This is a prototype, not a production service. It performs no identity or background screening, and it doesn't support family delegation, teams, or account editing and deletion.
- Real accounts have not been tested end to end. Email sign-up, password recovery, Google and Apple sign-in, and a signed iPhone build are unverified. The backend schema and its database tests have run; the sign-in flows have not.
- Service credit is an owner-set policy value, not measured work time or official school verification.
- The AI helpers' output is a suggestion for a person to review. It isn't a safety assessment.
- Only the English interface has live real-account screens. The app includes nine languages, but the fluency of the non-English text isn't claimed or verified.
- `npm run ios:demo` and the Mac scan scripts need private data and extra model setup that aren't in the repository.

See [CREDITS.md](CREDITS.md) for attribution and [third-party notices](public/THIRD_PARTY_NOTICES.txt) for bundled dependency licenses.
