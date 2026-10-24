# FixList

FixList explores how older adults and their families can describe household jobs, review requests, and coordinate help from volunteers. The local demo walks through requesting a job, accepting it, tracking progress, and confirming completion.

Choose **demo mode** for fictional accounts and local data, including two blank starting profiles: older adult/requester and volunteer. On a compatible iPhone, optional guided room photos, an outline, and a silent clip up to 30 seconds can support a request. Photos and outlines can be exported or shared when you choose; video stays local. Experimental AI suggestions use photos, not video, and require human review.

Real accounts use Supabase Auth for sign-in and private elder or volunteer profile setup when configured. A closed single-pilot server workflow (requests, one volunteer per job, messages, elder confirmation, ratings, owner-approved service credit) is implemented as a database migration and client adapter. A real, verified account that the owner has approved for the pilot sees an English-navigation interface for the elder (draft, post, track, message, confirm, rate) or volunteer (browse coarse listings, accept, update progress, message, view approved service credit) role. It needs your own provisioned Supabase project and was tested only against mocks. Family delegation, background screening, teams, account editing/deletion, and account-linked captures are not supported.

## Stack

React, TypeScript, Vite, Capacitor, Swift, ARKit, Core ML, Supabase Auth, Three.js/Spark, Leaflet, and Vitest. The local demo needs no paid API keys.

## Run locally

Use Node 24.18+ within 24.x and npm 11.

```sh
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/Frostand/fixlist.git
cd fixlist
npm run setup
npm run dev
```

Open <http://127.0.0.1:5173> and choose demo mode. Setup installs locked dependencies without downloading the native model. The web writing helper uses rules and templates. Run `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:db` (in-memory PostgreSQL, no Docker) to check your copy.

For real-account setup, copy `.env.example` to ignored `.env.local` and supply `VITE_SUPABASE_URL` and the public `VITE_SUPABASE_PUBLISHABLE_KEY` from your own project. Keep provider flags false until configured; never put provider secrets or service-role keys in the client. Follow the [Supabase setup guide](docs/supabase-auth-setup.md) for both migrations, pilot provisioning, email/redirect settings, provider configuration and verification limits; [validation evidence](docs/auth-increment-validation.md) records what was and was not tested.

## Optional iPhone app

Use a Mac with full Xcode (opened once to finish setup) and [Git LFS](https://git-lfs.com).

```sh
npm run setup -- --ios
npm run ios:sync
npx cap open ios
```

Choose your signing team and device in Xcode, then run. Setup downloads about 181 MB of model weights; sync and native builds verify them. Apple's writing/chat model needs a supported device on iOS 26+ with the model and language available. Capture and voice need compatible hardware and permissions. Native auth is registered, but Apple capability/provisioning and live provider behavior still need configuration and signed-iPhone testing. A build or Simulator run does not qualify real-device behavior.

`npm run ios:demo` and the Mac research scripts require extra private data and model setup; the main demo does not.
