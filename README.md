<img src="assets/icon.svg" width="64" height="64" alt="">

# FixList

A local browser demo project for a proposed home-concern checklist and follow-through workflow. This repository currently contains a runnable **scaffold only**: project configuration, typed synthetic data, and a setup status page. The checklist, generated plan, assistance screening, request log, persistence, and printing are not implemented.

Use Node **24.18.0** (`.nvmrc`) and npm **11**:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. The dev server uses a fixed port and stops if that port is occupied.

The chosen stack is React, TypeScript, Vite, Vitest, and plain CSS. Exact versions are in [package.json](package.json) and [package-lock.json](package-lock.json). No backend, accounts, database, or external API is needed for the planned recording journey.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the local Vite development server on port 5173. |
| `npm run typecheck` | Check app and tooling TypeScript projects without emitting app files. |
| `npm run build` | Typecheck and produce the static build in `dist/`. |
| `npm run preview` | Serve the build locally on port 4173; run `build` first. |
| `npm test` | Run Vitest once. Temporarily allows no test files; this is not test coverage. |
| `npm run test:watch` | Run Vitest interactively during later implementation. |

[Architecture](docs/architecture.md) is the current technical authority. [Video shot list](docs/video-shot-list.md) defines what must actually work before filming. [AI disclosures](docs/ai-disclosures.md) records current assistance and the student-contribution requirement. The earlier [full product plan](fixlist-plan.md) is preserved as background and contains systems outside the current demo scope.

All current sample rooms, observations, programs, helpers, and requests are fictional. No program has been verified, no concern is human-confirmed, no helper has been contacted, and completion remains unconfirmed. Do not enter private home data into this scaffold.

Created in [T3 Code](https://t3.codes).
