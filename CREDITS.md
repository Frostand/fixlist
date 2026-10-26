# Credits and licenses

## Libraries and tools

| What | Used for | License |
| --- | --- | --- |
| [React](https://react.dev), [Vite](https://vite.dev), [TypeScript](https://www.typescriptlang.org), [Vitest](https://vitest.dev) | App, build, tests | MIT / Apache-2.0 |
| [Capacitor](https://capacitorjs.com) | iPhone packaging | MIT |
| [Supabase JS](https://github.com/supabase/supabase-js) | Optional real-account backend client | MIT |
| [Leaflet](https://leafletjs.com) 1.9.4 | Volunteer map | BSD-2-Clause |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) map tiles | Map data, © OpenStreetMap contributors | ODbL |
| [three.js](https://threejs.org), [Spark](https://github.com/sparkjsdev/spark) | 3D scan viewer | MIT |
| [Atkinson Hyperlegible Next](https://www.brailleinstitute.org/freefont/) (Braille Institute), [Zilla Slab](https://github.com/mozilla/zilla-slab) (Mozilla) | Fonts | SIL OFL 1.1 |
| Apple Foundation Models, Speech, AVSpeechSynthesizer, ARKit, Core ML | On-device writing and photo review, voice, room capture | Apple SDK terms |
| [OpenCLIP](https://github.com/mlfoundations/open_clip) ViT-B-32 ([laion2b weights](https://huggingface.co/laion/CLIP-ViT-B-32-laion2B-s34B-b79K)) | On-device photo relevance scoring | MIT (see `ios/App/App/HazardModel/NOTICE.txt`) |
| [COLMAP](https://colmap.github.io)/pycolmap, [Brush](https://github.com/ArthurBrussee/brush), NumPy, Pillow, ffmpeg | Mac scan tools (not shipped in the app) | BSD-3 / Apache-2.0 / BSD / MIT-CMU / GPL v3 build |
| StartLux-Decision 9B (MLX) | Optional Mac photo review (not shipped) | Weights CC BY-NC 4.0 |

## Content and media

- **CDC "Check for Safety" (2017):** the next-step wording is paraphrased from this [brochure](https://www.cdc.gov/steadi/pdf/steadi-brochure-checkforsafety-508.pdf) and cited in the app. No CDC text or images are copied.
- **Eldercare Locator** ([Administration for Community Living](https://eldercare.acl.gov/)): a real resource, linked in the app.
- **Optional local 3D apartment:** "UE4Arch.com – Viennese apartment" by UE4Arch.com on [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:UE4Arch.com_-_Viennese_apartment.webm), licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). It's a computer render, not a real home. The footage was trimmed to 58–158 s and rebuilt as a 3D scan, so changes were made. The derived scan carries the same license and is not included in the submission build.
- **Evaluation photos:** from Wikimedia Commons and Openverse under mixed licenses. They're used only for local model testing and aren't redistributed.
- **Playroom test scan** (Inria 3D Gaussian Splatting set): license unclear, so it's used for internal testing only and isn't part of the app.
- **App icon:** our own.
- **People, homes, and addresses in the demo** are fictional.
