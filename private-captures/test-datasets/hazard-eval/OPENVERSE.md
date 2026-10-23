# Openverse additions (2026-10-18)

## Collection and handling

Added 26 Openverse images to this local evaluation set. Searches used the anonymous Openverse Images API with the requested User-Agent and license filter: CC0, PDM, CC BY, and CC BY-SA. Each retained row records the Openverse ID, source page and image URLs, creator, provider, license/version, query, and query-family number.

Candidates were screened visually for photographs, indoor home-like scenes, and no person's face as the main subject. Obvious renders, illustrations, outdoor scenes, unrelated results, and other unsuitable images were skipped. Each retained original was re-encoded as an RGB JPEG with a 1024 px maximum side and no EXIF metadata. The manifest SHA1 is of the downloaded source bytes. Duplicate Openverse IDs, landing-page URLs, and source-byte SHA1s were skipped; creator groups use normalized names and stay at no more than three images per creator.

searchConcept records the query family only. No hazard conditions are labeled here; a separate worker will label by viewing.

## Retained counts

| Query family | Retained |
| --- | ---: |
| 1. Rugs | 5 |
| 2. Cords | 1 |
| 3. Stair clutter | 2 |
| 4. Handrails | 0 |
| 5. Dark stairs | 0 |
| 6. Dim bedrooms and hallways | 12 |
| 7. Shower or tub floors | 5 |
| 8. Grab bars | 1 |
| **Total** | **26** |

| License | Count |
| --- | ---: |
| CC BY 2.0 | 14 |
| CC BY-SA 2.0 | 8 |
| CC BY-SA 3.0 | 1 |
| CC0 | 2 |
| PDM | 1 |

| Provider | Count |
| --- | ---: |
| flickr | 23 |
| rawpixel | 2 |
| wikimedia | 1 |

There are 23 distinct creator groups; the largest group has two retained images. These 26 additions remain below the approximate 150-photo goal, and several query families have few or no retained images.

## Retrieval failures and rate limits

The acquisition helper logged 39 API request failures: 37 read timeouts and two HTTP 504 responses. Two additional metadata-only requests for “broken banister” timed out; three direct API probes also timed out.

Image downloads logged 14 failed images and 24 HTTP 429 responses with Retry-After values (22 responses specified 10 seconds and two specified 600 seconds). Three earlier 429 responses occurred before Retry-After capture was added. The final Wikimedia-hosted image request was stopped during a 600-second Retry-After wait because its expiry would pass the 75-minute work limit; no further request was sent to that host. No API 429 was observed.

At final validation, the shared manifest had 86 parseable rows and unique IDs. Every listed file existed and opened with Pillow; no NC or ND license was present. All 26 new rows were JPEGs at or below 1024 px per side, had stripped EXIF, required fields, unique source identifiers, and no creator-cap violation.


## Re-collection (2026-10-18)

Re-collected 26 Openverse photos as `ov-0001` through `ov-0026` after confirming those IDs and filenames were absent. Searches used the Images API license filter `cc0,pdm,by,by-sa`, `mature=false`, `page_size=20`, and the project User-Agent. Each retained original was re-encoded to JPEG with a maximum 1024 px side and stripped EXIF. Manifest `sha1` values refer to downloaded source bytes.

The images were visually screened for indoor home-like photographic scenes and no face as the main subject. `searchConcept` and `searchQuery` record search provenance only; no hazard conditions were labeled.

| Query family | Retained |
| --- | ---: |
| 1. Rugs | 7 |
| 2. Cords | 2 |
| 3. Stair clutter | 2 |
| 4. Handrails | 0 |
| 5. Dark stairs | 0 |
| 6. Dim bedrooms and hallways | 6 |
| 7. Shower or tub floors | 8 |
| 8. Grab bars | 1 |
| **Total** | **26** |

| License | Count |
| --- | ---: |
| CC BY 2.0 | 23 |
| CC BY-SA 2.0 | 3 |

| Provider | Count |
| --- | ---: |
| flickr | 26 |

The 26 additions have 23 creator groups; no group exceeds two images. Collection encountered 43 API read timeouts and 16 image-host HTTP 429 responses with `Retry-After: 10` honored. `upload.wikimedia.org` requested a 600-second wait and was skipped for the rest of the run. Eight downloads failed after retry and one duplicate source SHA1 was skipped. Final validation found unique manifest IDs, 26 readable JPEGs within the size limit, stripped EXIF, and no NC/ND license.
