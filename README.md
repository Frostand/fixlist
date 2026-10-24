# FixList

FixList is a local demo that connects older adults and their families with volunteers for household tasks.

## How it works

1. A requester describes a task by typing, by voice, or with room capture. Native features depend on the device.
2. The requester reviews the request and posts the job.
3. A volunteer accepts the job and tracks its progress.
4. The requester confirms completion, and the demo records service hours.

The demo uses fictional accounts and local data. It has no production backend and no real Apple authentication.

## Tech stack

- React, TypeScript, Vite
- Capacitor, with Swift, ARKit, and Core ML native plugins
- Three.js and Spark for room visualization
- Leaflet for maps
- Vitest for tests
- Optional Python scan tools

## Run it yourself

**Requirements:** Node 24.x (24.18.0 or newer, see `.nvmrc`) and npm 11.

The repository includes model weights stored with Git LFS. Install [Git LFS](https://git-lfs.com) and run `git lfs install` before cloning.

```sh
git clone https://github.com/Frostand/fixlist.git
cd fixlist
npm ci
npm run dev
```

Open <http://127.0.0.1:5173>.

### Checks

```sh
npm run typecheck
npm test
npm run build
```

### iOS (optional)

This requires macOS and Xcode.

```sh
npm run ios:sync
npx cap open ios
```

In Xcode, choose a device and run the app. Native capabilities require a compatible device.
