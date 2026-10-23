# FixList sources and third-party credits

## Third-party libraries and tools
Versions are from `package.json` and `scan/README.md`. Licenses are given only where established.

| Item | Version | Use | License |
| --- | --- | --- | --- |
| React, React DOM | 19.3.1 | UI | MIT |
| TypeScript | 7.0.2 | Language | Apache-2.0 |
| Vite, @vitejs/plugin-react | 8.3.4, 6.1.2 | Build | MIT |
| Vitest | 5.0.5 | Tests | MIT |
| three.js | 0.186.1 | 3D viewer | MIT |
| Spark (@sparkjsdev/spark) | 2.3.1 | Gaussian-splat rendering | MIT |
| Capacitor (core, ios, cli) | 8.5.3 | iOS packaging | MIT |
| Atkinson Hyperlegible, Zilla Slab (Fontsource) | 5.3.0 | Fonts | SIL OFL |
| pycolmap / COLMAP | 4.2.1 | Camera poses | BSD-3-Clause |
| ffmpeg | 9.0.1 | Frame extraction (separate command-line tool, not part of the app) | GPL v3 build |
| Brush | 0.3.0 (prebuilt Apple Silicon) | Gaussian-splat training | Apache-2.0 |
| NumPy, Pillow | 2.5.4, 13.0.0 | Scan scripts | BSD-3-Clause; MIT-CMU |
| MLX, mlx-vlm, `startlux-decide` | 0.32.4, 0.7.8, 1.1.0 | Local model runtime | MIT, MIT, Apache-2.0 (StartLux weights: CC BY-NC 4.0) |
| torch, torchvision, kornia, LightGlue/ALIKED | per `scan/README.md` | Optional matching fallback; not used for the demo scan | TODO verify |
| @types/* packages | see `package.json` | Type definitions | MIT |

## Media and licensing record

| Item | Source and license | Status |
| --- | --- | --- |
| Demo apartment scan | "UE4Arch.com – Viennese apartment", Wikimedia Commons, CC BY-SA 4.0. A photoreal computer render, not a real home. Segment 58–158 s. | Used and shown. The scan and any frames are **adaptations**: give attribution, a license link and a modification notice. ShareAlike applies to the adapted footage and scan, not automatically to the whole app or video. A collection of works is treated separately (see [CC FAQ](https://creativecommons.org/faq/) and the [legal code](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en)). TODO Andrew or an adult: confirm this reading. |
| Playroom test scan | Deep Blending "playroom" images in the Inria 3D Gaussian Splatting evaluation archive. License not established in the repo. | **Do not show in the public video. Internal testing only.** |
| Evaluation photos | Wikimedia Commons and Openverse, mixed licenses | Private, local only, not redistributed |
| App icon and launch screen | FixList house mark, `public/favicon.svg`, project-authored | Original |
| CDC "Check for Safety" checklist (2017) | Basis for the plain-language next steps; FixList paraphrases it in its own words and cites it | No CDC text or images copied |
| Eldercare Locator | Real resource (Administration for Community Living) | Cited with source and date in the app |

**Credits line for the video:**

> Source footage: "UE4Arch.com – Viennese apartment" by UE4Arch.com, Wikimedia Commons, licensed CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/), https://commons.wikimedia.org/wiki/File:UE4Arch.com_-_Viennese_apartment.webm. Trimmed to 58–158 s, frame-sampled and reconstructed into a 3D scan; changes were made.

Author, license and URL checked on the Commons file page on 2026-10-18 (original upload date 22 April 2015; source: UE4Arch on YouTube).
