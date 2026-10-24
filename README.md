# FixList

FixList is a local demo that connects older adults and their families with volunteers for household tasks.

## How it works

1. A requester describes a task by typing, by voice, or with room capture. Native features depend on the device.
2. The requester reviews the request and posts the job.
3. A volunteer accepts the job and tracks its progress.
4. The requester confirms completion, and the demo records service hours.

The demo uses fictional accounts and local data. It has no production backend and no real Apple authentication.

Built with React, TypeScript, Vite, Capacitor/Swift, ARKit, Core ML, Three.js/Spark, Leaflet, and Vitest.

## Run it yourself

**Requirements:** Node 24.x (24.18.0 or newer, see `.nvmrc`) and npm 11.

Web setup needs no Git LFS or Xcode. Skip native weight downloads when cloning:

```sh
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/Frostand/fixlist.git
cd fixlist
npm run setup
npm run dev
```

Open <http://127.0.0.1:5173>. Default setup (also `npm run setup -- --web`) checks Node/npm, installs locked dependencies, and leaves native weights unhydrated.

### Checks

```sh
npm run typecheck
npm test
npm run test:setup
npm run build
```

### iOS (optional)

Install [Git LFS](https://git-lfs.com) and full Xcode on macOS. Complete Xcode's first-launch setup and select its developer directory with `xcode-select`.

```sh
npm run setup -- --ios
npm run ios:sync
npx cap open ios
```

Native setup checks prerequisites, configures repository-local LFS without forcing hook replacement, downloads about 181 MB of pinned weights, verifies them, then installs dependencies. Sync and direct Xcode builds verify model identity without downloading anything. For an older failed build, use Xcode's **Product > Clean Build Folder**, then rebuild. `npm run ios:model:check` checks the source model independently.

The bundled Core ML photo model is separate from the iOS 26 Apple Foundation Models writing assistant. The assistant requires supported hardware and passing OS availability and locale checks. A successful build or Simulator launch does not validate physical iPhone capture, speech, or Apple model behavior.

`ios:demo` is a maintainer workflow requiring ignored private scans and optional Python tooling; it is unnecessary for the public demo. Optional Mac scan research tools are outside this setup path.
