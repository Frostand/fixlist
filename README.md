# FixList

FixList is a demo app that connects older adults and their families with volunteers for household jobs. It uses fictional accounts and local data, with no live backend and no real Apple sign-in.

## How it works

1. **Request:** A requester describes the job by typing, speaking, or capturing the room.
2. **Review and post:** The requester checks the request and posts it.
3. **Volunteer:** A volunteer accepts the job and tracks its progress.
4. **Confirm:** The requester confirms the job is done.

## Built with

React, TypeScript, Vite, Capacitor, Swift, ARKit, Core ML, Three.js/Spark, Leaflet, and Vitest. No paid API keys are needed.

## Run it yourself

You need Node 24 (24.18.0 or newer, below 25) and npm 11.

```sh
GIT_LFS_SKIP_SMUDGE=1 git clone https://github.com/Frostand/fixlist.git
cd fixlist
npm run setup
npm run dev
```

Open <http://127.0.0.1:5173>. Setup checks your versions and installs the locked dependencies without downloading the native model. On the web, the writing helper uses simple rules and templates.

To check your copy, run `npm run typecheck`, `npm test`, and `npm run build`. `npm run test:setup` is an optional check of the setup script.

## Optional: iPhone app

You need a Mac with full Xcode (opened once so first-launch setup is complete) and [Git LFS](https://git-lfs.com).

```sh
npm run setup -- --ios
npm run ios:sync
npx cap open ios
```

In Xcode, choose your signing team and device, then run. Setup downloads about 181 MB of model weights from GitHub, and builds verify them. If an older build has a bad model, use **Product > Clean Build Folder**.

The photo-relevance model comes through Git LFS. Apple's writing and chat model is provided by the operating system, so it needs a supported device on iOS 26 or newer with the model and language available. Capture and voice need a compatible device and permissions. A successful build or Simulator run does not confirm behavior on a real iPhone.

`npm run ios:demo` and the Mac research scripts need extra private data and model setup. The main demo does not need them.
