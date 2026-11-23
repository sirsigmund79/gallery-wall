# Decisions log

Deviations from the spec (`docs/SPEC.md`), and choices the spec left open. Newest last.

## M0 — Scaffold

- **UI framework: React 19 + Zustand.** Spec default; Svelte not used.
- **Routing: a ~20-line hash router (`src/app/router.ts`) instead of a routing library.** Three
  tabs don't need one, and hash routes work on any static host with no rewrite rules. Revisit when
  nested routes (wall → layout editor) arrive in M2/M3.
- **TypeScript pinned to 5.9.x.** TypeScript 7 (native port) is current, but the lint toolchain
  (typescript-eslint) is built against the 5.x compiler API. Revisit once it officially supports 7.
- **Local HTTPS: `@vitejs/plugin-basic-ssl`, enabled with `vite --mode lan` (`npm run dev:host` / `npm run preview:host`).** A mode flag
  rather than an env var, because `HTTPS=1 cmd` syntax fails in Windows shells. It generates a
  throwaway self-signed certificate at dev time, so nothing cert-related lives in the repo. Phones
  will show a certificate warning once; mkcert or a cloudflared tunnel remain alternatives
  (see README). Cert/key files and tunnel configs are git-ignored.
- **Single-threaded WASM for now; no COOP/COEP headers yet.** Nothing multi-threaded exists yet.
  Revisit after the M0.5 OpenCV.js / segmentation spikes.
- **Schema v2 exists from day one.** v1 is the base tables; v2 adds `status` and multi-entry `tags`
  indexes on `pieces` with a backfill upgrade. It's a real migration (the library filters in §6.3
  need it) and lets the migration test check an actual upgrade instead of a no-op.
- **`ArtPiece.image` / `thumb` are optional** (spec has them required). §6.3 allows pieces with no
  photo ("render a neutral labelled rectangle"), so the type has to allow it.
- **Units default from locale:** `in` for regions US, LR, MM; `cm` everywhere else (open question 2
  in the spec; the spec's stated default is locale-based). The user can change it in Settings.
- **`glob` forced to v14 via `overrides` in package.json.** `vite-plugin-pwa` → `workbox-build`
  (latest, 7.4.1) still asks for `glob@^11`, which is deprecated and has advisories. workbox-build
  only calls `globSync(pattern, options)`, which v14 keeps unchanged. Checked: the generated
  service worker lists every built file, and unit + e2e tests pass. `npm audit` is clean. Remove the
  override once workbox-build depends on a current glob.
- **Secret scanning:** gitleaks runs in CI on every push and PR, in addition to the broad
  `.gitignore`. The app has no backend and needs no secrets; `.env.example` documents that.

## Not yet verified (needs a real device)

- M0 "installable PWA runs on a phone over HTTPS": verified in desktop Chromium with mobile
  emulation (service worker registers, manifest valid, settings persist across reload). Still needs a
  check on a real iPhone (Safari, Add to Home Screen) and Android phone (Chrome install prompt).

## M1–M3 (core loop), built ahead of M0.5

- **Order deviation: M0.5 spikes skipped for now.** The owner asked for a working app, and the
  spikes need real phones. Nothing built so far depends on what the spikes evaluate (OpenCV.js,
  SlimSAM, quad detection, markers). Konva and Dexie were adopted directly. The spikes still need to
  run before M4 (art from photo) and M5 (tap-to-segment).
- **Built:** art library (manual sizes, hang specs, status/tags/notes, optional photo, duplicate,
  delete with layout warning); wall creation from an imported/camera photo with one or more
  measurements, quality badge, two-axis correction, wall edges, floor/ceiling lines, re-calibration;
  layout editor (true-scale canvas, pan/pinch/wheel zoom, drag, edge/centre/wall-line/equal-gap
  snapping, numeric position entry, nudge with hold-to-repeat, centre on wall, lock, remove,
  undo/redo, multiple layouts, autosave); hang guide (nail positions from the wall's left edge and
  floor/ceiling/top, printable).
- **Deferred within those milestones:**
  - *Guided capture* (live camera with level overlay and gravity rectification, §5.2/§6.1). Needs
    sensor sign checks on real devices. Photos come in through the file input (`capture` opens the
    camera directly on phones), so every wall is currently an "import" and one measurement grades
    as **Check**, as §5.4 specifies.
  - *Fix angle with a known rectangle* (§5.5.2). The spec says to use OpenCV.js
    `getPerspectiveTransform`, which waits on the M0.5 OpenCV spike.
  - *Four-corner confirm for piece photos* (§6.3b). The photo is stretched to the typed size; the
    UI asks the user to crop to the frame first.
  - Align/distribute, multi-select, duplicate-in-layout, measurement overlay and compare view (§6.5).
- **Two-axis correction without resampling.** Instead of stretching the image by `sx/sy`, the wall
  stores both per-axis scales and the editor draws the photo with non-uniform scale. Same result,
  no extra image copy, and re-calibrating doesn't degrade the photo.
- **Quality grading with two-axis correction.** One horizontal plus one vertical measurement fit
  `sx`/`sy` exactly, so there's nothing left to verify against: graded **Check** with "add a third
  measurement". Anisotropy above 10% grades **Poor** (photo too angled for first-order correction).
  The "±%" figure is only shown when quality is **Good**.
- **Floor/ceiling lines are horizontal** (a y value), matching `Wall.datums`. Without gravity
  rectification a tilted photo makes them approximate. Acceptable until guided capture lands.
- **A piece can appear at most once per layout.** It's a physical object.
- **Layouts are stored inside the wall record** (as in spec §4). Autosave writes the whole wall,
  debounced 400 ms, and flushes on `visibilitychange`/`pagehide`.
- **Undo/redo uses placement snapshots** (cap 100) rather than a command stack. Placements are
  small, and snapshots can't get out of sync.
- **New pieces** drop at the wall's centre (at 57 in eye level if a floor line exists), or beside
  existing art with a 2 in gap if the centre is taken.
- **Hang defaults are round inch values** (sawtooth 1/2 in, wire/D-ring drop 3 in, D-ring inset
  2 in) so they don't display as "2 15/16 in".
- **The editor (Konva) is lazy-loaded**, keeping the initial bundle to ~114 KB gzipped.
- **E2E:** Playwright pinned to the version of the browsers pre-installed in the dev container.
  The synthetic wall photo is drawn in the browser by the test, so no image fixture is committed.
  WebKit runs in CI only (not installed in the dev container).

## M4 (art from photo) + guided capture

### M0.5 spike #2 (OpenCV.js), done in the dev container. Go.
- **Package: `@techstark/opencv-js@4.12.0-release.1`** (Apache-2.0; OpenCV itself is Apache-2.0).
  5.0.0 exists but is newer and less proven; revisit later.
- **Exposes everything we need:** `getPerspectiveTransform`, `warpPerspective`, **`findHomography`**
  (the spec was unsure), `Canny`, `findContours`, `approxPolyDP`, `minAreaRect`,
  `adaptiveThreshold`, `morphologyEx`, `Laplacian`, `boxFilter`. No custom build needed.
- **Size:** 10.8 MB raw, **3.5 MB gzipped** (WASM inlined as base64). WASM init ~0.2 s in Node.
  Real-phone load time is still to be measured.
- **Gotcha:** the module object has a `then` method (Emscripten). `await import()` and Vitest's
  module loader both hang on it. The worker imports it statically and waits for
  `onRuntimeInitialized`; tests load it with Node's `require` (`tests/cv.ts`).
- **Delivery:** it runs in a module Web Worker (`src/cv/cv.worker.ts`), which becomes its own
  10.8 MB chunk, downloaded the first time a CV feature is used. It's excluded from the service
  worker's precache (so other users don't pay for it) and cached on first use with a CacheFirst
  runtime rule, so it works offline after that. Single-threaded build, so no COOP/COEP needed.

### M0.5 spike #3 (quads): partially done
- `jscanify` / `opencv-document-scanner` find one sheet (largest contour). We **adapted the approach**
  (edges → contours → `approxPolyDP`) and **extended** it for many pieces. No code copied.
- **Passes:** (0) colour distance from the floor (floor colour sampled along the photo's border, in
  Lab, lightness down-weighted); (0b) on textured floors only, regions much smoother than the floor;
  (1) auto-Canny + close; (2) Otsu both polarities. Contours → 4-point `approxPolyDP`, or
  `minAreaRect` when the contour is ≥ 88% rectangular. Slivers (min side < 3% of the image, aspect
  > 6:1) are rejected.
- **Every candidate is refined to sub-pixel edges** at full resolution (`src/cv/refine.ts`, pure TS):
  a wide step detector along each side's normal, polarity voting, interior peaks only, robust line
  fit, corner intersection. Its *edge support* (share of samples on the fitted line) is added to the
  candidate's score, so duplicates from different passes converge and the best-supported one wins;
  then nested quads (mats, prints inside frames) are dropped.
- **Synthetic results (Node tests):** all pieces found, including a wood frame on a wood floor and
  nothing on an empty floor; corners within ~1 px; sizes within 0.5% on a straight-down photo.
- **Known weak case:** a frame the *same colour as the floor's grain* is found, but an edge running
  parallel to the grain can snap to a grain line (≈1% error in the browser fixture). The user can
  drag the corner, and snap suggestions still catch it.
- **Still needed:** the spec's real-photo run (5 floor photos, several pieces each, on real phones).

### Measuring
- **Reference = a piece (or a sheet of paper / a card) whose size you know.** Presets for US Letter,
  A4 and credit card fill both sides and default to "only a reference, not art".
- **Calibration depends on the photo:**
  - *Straightened by gravity* (level camera): a least-squares **similarity** (scale + rotation) to the
    reference. No perspective is fitted, so corner errors aren't amplified far from the reference.
    One side is enough.
  - *Ordinary photo, both sides known:* full **perspective** from the reference
    (`cv.getPerspectiveTransform`, per spec). Error grows with distance from the reference; the UI
    recommends the biggest piece you know. Test bound: 1.5% for a small A4 reference far from some
    pieces.
  - *Ordinary photo, one side known:* uniform scale, flagged **Check** in the UI.
- **Sizes:** mean of opposite edges in mm; confidence per spec (high ≤ 2% / 3°, check ≤ 5%; we use
  6° for "check" angles, since the spec gives no angle for that tier); snap suggestions to common
  in/A/cm sizes within 1.5%.
- **Crops** are warped to the measured aspect, long edge ≤ 1600 px and never upsampled past the
  source. A "Rotate 90°" button handles pieces laid sideways.
- **`sourcePhoto` is not stored** on scanned pieces: one photo would be shared by several pieces, and
  deleting one piece deletes its blobs.

### Guided capture (gyro)
- **`src/geometry/gravity.ts` implements §5.2 as specified** (`H = K·Rᵀ·K⁻¹`), in wall mode (level
  verticals; keeps yaw) and floor mode (virtual camera straight down). Tests render a synthetic grid
  through known rotations and check it comes out axis-aligned (200 random pitch/roll cases).
- **Smoothing:** the mean of the last 8 gravity *vectors* (not Euler angles, which jump near upright).
- **Screen rotation:** device frame → screen frame by `screen.orientation.angle`, then to camera.
  Getting this right needs real-device verification. The **Sensor check** screen
  (Settings → Camera) shows β, γ, g and the tilt readouts, with the expected values for flat/upright.
- **Focal length:** the spec's diagonal formula, applied to a 4:3 frame of the image's long edge, so
  16:9 video frames get the same focal length as the 4:3 sensor.
- **Output is cropped to the inside of the warped image** (`planWarpInner`): empty corners would look
  like objects to detection and spoil floor-colour sampling. Corrections over 15° are skipped.
- **Capture is highlighted (green) when level, but always allowed** (the spec allows "enabled or
  highlighted"). Sensors missing or denied → a plain camera with a note.
- **Chromium now has `DeviceOrientationEvent.requestPermission()` too** (found in testing). The same
  code path as iOS handles it.
- **Frames come from the `<video>` element** (`getUserMedia`, ideal 4096×3072). `ImageCapture.takePhoto()`
  could give full resolution on Android Chrome; not used yet.
- **Walls:** "Use camera with level" is now the primary option. Its photos are straightened, recorded as
  `capture: 'guided'` with the gravity values, and one measurement grades **Good** (spec §5.4).
