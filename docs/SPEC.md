# HangPlan — Product & Technical Spec (v0.2)

*Working title. A mobile-first web app (PWA) for planning wall-art arrangements from real photos and real dimensions, with no AI-generated imagery.*

---

## 0. How to use this document (instructions for Claude Code)

- Build in the milestones in §9, in order. Each milestone has acceptance criteria. Do not start a milestone until the previous one meets its criteria.
- Prefer small, tested, pure-TypeScript geometry modules (§5) over UI cleverness. The geometry is the product; if it's wrong, nothing else matters.
- Commit at the end of each milestone. Keep a `DECISIONS.md` file where you log any deviation from this spec and why.
- Camera and motion sensors require a secure context. For testing on a real phone, serve over HTTPS (e.g. `vite --host` with mkcert, or a tunnel such as cloudflared). Test on a real iPhone (Safari) and a real Android phone (Chrome) at every milestone; emulators lie about cameras and sensors.
- When something is ambiguous, pick the simplest option that satisfies the acceptance criteria, note it in `DECISIONS.md`, and keep going.
- Library names, model sizes, and licenses mentioned below are starting points. Verify current versions, sizes, and licenses before committing to them.

---

## 0A. Reuse-first policy and prior art

**Rule for Claude Code:** do not write from scratch anything in the "Reuse" column below. Wrap it, adapt it, or copy small permissively licensed snippets with attribution in `THIRD_PARTY.md`. Our own code is limited to the "We write" column; that is where the product's value is. The point is to save time and tokens and to lean on code that many people have already tested.

Before adopting any candidate (budget about 30 minutes each; read the README and one example, not the whole repo): check the license (MIT, Apache-2.0, BSD, ISC or similar only; no GPL/AGPL; no unlicensed code), last release date, bundle size, and that it runs on a real iPhone (Safari) and Android phone (Chrome). If it fails, log it in `DECISIONS.md` and move to the next candidate or the fallback.

| Capability | Reuse (candidates found) | We write | Verify |
|---|---|---|---|
| Tap-to-segment (cutouts) | Transformers.js + SlimSAM (`Xenova/slimsam-77-uniform`). Its public "segment-anything-webgpu" demo (Apache-2.0 per its metadata) already does positive/negative clicks and cutting out a mask. WebSAM (github.com/Xevion/WebSAM) is a good architecture reference: ONNX Runtime Web, worker via Comlink, weights cached in OPFS, SlimSAM-77 INT8 about 14 MB on WASM, while its SAM 2 variants need WebGPU and are 145 MB or more. It states no license, so read it but do not copy it | Tap UI, mask cleanup, storage, render order | Current package name (I believe the original `@xenova/transformers` has been superseded by Hugging Face's own package); model license; iPhone Safari WebGPU/WASM speed |
| Rectangle / quad detection | `jscanify` (MIT) and `opencv-document-scanner` (MIT): paper detection plus perspective extraction on OpenCV.js; OpenCV's own browser document-scanner tutorial | Multi-quad detection (they find one sheet), corner-editing UI, confidence scoring | Behaviour with several pieces in one photo; OpenCV.js load size |
| Homography and warping | OpenCV.js `getPerspectiveTransform` and `warpPerspective`; `cv-homography` (a trimmed OpenCV.js build for perspective operations); `@techstark/opencv-js` for TypeScript types | Gravity-to-rotation homography (about 30 lines, standard `H = K·R·K⁻¹`), calibration model, quality score | Sources conflict on whether `findHomography` is in the default OpenCV.js build; confirm before relying on it, otherwise use the trimmed or a custom build |
| Canvas, drag, snapping | Konva; its official "Objects Snapping" example (edges, centres, guide lines); the `use-konva-snapping` hook | Equal-gap snapping, datum snapping, numeric entry, mm-based coordinates | Touch behaviour on iOS |
| Layout packing | `maxrects-packer` (MIT), `potpack` | Style logic (grid/row/salon), hero placement, scoring, variants and seeds | Neither packs "around a centre": use as the engine, then centre and score |
| Fiducial markers (stretch) | `aruco-rs` (WASM, MIT, AR.js org), `apriltag-js-standalone` (AprilTag C library compiled to WASM), `js-aruco2`. Markerless prior art: `EdwardLu2018/wasm-ar` (ORB homography tracking in WASM) | Marker-to-wall mapping, multi-marker homography, smoothing, UI | Pick one in the M0.5 spike (accuracy, speed, license) |
| Stitching (v2) | OpenCV's Stitcher has a SCANS mode for flat scenes, but the stitching module is not in the default OpenCV.js build, and forum threads describe custom builds as fiddly. `latsic/imgalign` (MIT) is a browser/WASM reference; avoid SURF/SIFT (patent caveat) | Pan capture UI, calibration of the stitched result | The spike decides: custom build, minimal in-house ORB pipeline, or skip |
| PDF output | `pdf-lib` | Tile grid, registration marks, hook crosshairs (small: draw the same vector geometry on each page with an offset) | I found no JS "tile at 1:1" library; poster-tiling tools only work on existing PDFs |
| Whole-app prior art | Only small open-source gallery-wall planners turned up (e.g. `tstraub89/gallery_wall`, React/Vite/TypeScript; I could not open it to check its license or features). Commercial apps (Dex, MatGlass, GalleryPlanner and others) are not reusable | Everything that makes this app different: photo calibration, cutouts, inventory, hang guide | Skim any permissively licensed repo for hook-offset math and UX ideas; do not depend on it |
| Sensor-based levelling | No library found | Small: see §5.2 | iOS/Android sign conventions |

**What this means for scope.** The genuinely new work is the integration: one-measurement calibration with a quality score, gravity-assisted capture, the data model, equal-gap snapping, auto-arrange scoring, and the hang guide. Everything else should be adopted.

---

## 1. Product summary

**Problem.** Arranging art on a wall means either putting in many nails and moving them, or cutting cardboard templates and taping them up. Both are slow and damage walls.

**Solution.** The user builds an inventory of their art (real dimensions, entered by hand or measured from a photo), photographs a wall, calibrates it with one measurement, and arranges the art on that wall photo at true scale. The app then produces a hanging guide (nail coordinates and printable 1:1 paper templates).

### Non-negotiable principles

1. **No generative AI imagery.** Every pixel shown is the user's own photo, either rendered directly or masked/warped geometrically. A promptable *segmentation* model (outlines only) is allowed because it produces masks, not imagery.
2. **Real dimensions or nothing.** Every piece and every wall has a true size in millimetres. The UI must make the source and confidence of every measurement visible and editable.
3. **Simple inputs.** Photo in, size out, with at most one number typed by the user. Everything else must be optional refinement.
4. **Local-first and private.** Photos of people's homes never leave the device in the MVP. No account, no backend.
5. **One wall at a time.** No 360° room modelling.

### The "wow" features (all in scope; phased in §9)

| # | Feature | Section |
|---|---------|---------|
| 1 | Tap an object (e.g. a TV) to cut it out; art can slide behind it | §6.4 |
| 2 | One measurement calibrates the whole photo | §5, §6.2 |
| 3 | Live camera "ghost" overlay of the planned layout with nail marks | §6.8 |
| 4 | Auto-arrange suggestions from the inventory | §6.6 |
| 5 | Gyro-assisted capture (level guide, auto-straightening) | §6.1 |
| 6 | Sweep video to stitch wide walls | §6.9 |

---

## 2. Platform & constraints

- **Target:** mobile web (PWA, installable, offline-capable after first load) on iOS Safari 16+ and Android Chrome (current). Must also work on tablet and desktop browsers (responsive; mouse/keyboard supported), but design mobile-first.
- **WebXR is NOT available on iOS Safari.** Do not depend on WebXR, ARKit, or plane detection. All measurement is photo-based.
- **Secure context required** for `getUserMedia` and device motion.
- **iOS motion permission:** `DeviceOrientationEvent.requestPermission()` must be called from a user gesture. Handle "denied" gracefully (features degrade to manual; nothing breaks).
- **Hosting:** static hosting. If using multi-threaded WASM (onnxruntime-web, OpenCV.js threads), the host must send COOP/COEP headers (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`). Otherwise fall back to single-threaded WASM. Document whichever you choose in `DECISIONS.md`.
- **Canvas limits:** iOS Safari limits canvas area (~16.7 MP). Cap working images at a 4096 px long edge, and downscale for editing (§10).

---

## 3. Tech stack & architecture

| Concern | Choice (default) | Notes |
|---|---|---|
| Language | TypeScript (strict) | |
| Build | Vite | |
| UI | React + a small state store (Zustand) | Svelte is acceptable; pick one and stay with it |
| Canvas editor | Konva (react-konva) | Pan/zoom, hit testing, touch gestures |
| Computer vision | OpenCV.js (WASM), loaded lazily | Rectangle detection, homography, warp, morphology |
| Segmentation | Transformers.js with a SlimSAM model (§0A); verify package name and model license | Start from the public "segment-anything-webgpu" demo code; WebGPU if available, else the small INT8 WASM variant; lazy-load; cache the weights |
| Storage | IndexedDB via Dexie | Images stored as Blobs |
| PDF | pdf-lib (or jsPDF) | Hang guide + 1:1 templates |
| Markers (stretch) | One of `aruco-rs`, `apriltag-js-standalone`, `js-aruco2` (§0A) | Chosen in the M0.5 spike; do not rely on the OpenCV.js `aruco` module without checking the build |
| Tests | Vitest (unit), Playwright (e2e, WebKit + Chromium mobile emulation) | |
| PWA | Workbox / vite-plugin-pwa | |

### Suggested layout

```
src/
  geometry/        # PURE TS, no DOM. Fully unit-tested.
    calibration.ts     # scale fit, anisotropy, quality
    homography.ts      # thin wrappers over OpenCV.js (4-point) + apply, invert, output bounds
    gravity.ts         # sensor angles -> rectifying homography
    quad.ts            # quad metrics, dimension extraction, confidence
    layout/            # packing, scoring, snapping, hook math
  cv/              # OpenCV.js wrappers (lazy), rect detection, warp, mask cleanup
  segmentation/    # onnxruntime-web session, prompt handling, model cache
  capture/         # getUserMedia, level overlay, sensors, photo import
  db/              # Dexie schema, migrations, import/export
  features/
    art/ walls/ editor/ cutouts/ arrange/ export/ ghost/ stitch/
  ui/              # shared components
  workers/         # layout solver, heavy CV, segmentation
tests/
  fixtures/        # synthetic + real test images with ground truth
```

Heavy work (segmentation, layout solving, warping large images) runs in Web Workers. UI thread stays at 60 fps during drag.

---

## 4. Domain model & units

All lengths are stored internally as **millimetres (float)**. UI supports **in (with fractions, rounded to 1/16) and cm/mm**, toggled in Settings. Default from locale, user-changeable.

**Wall coordinate system:** origin at top-left of the rectified wall image, +x right, +y down, in mm.

```ts
type Mm = number;
type BlobRef = string; // key into the blobs table

interface HangSpec {
  type: 'sawtooth' | 'wire' | 'dring2' | 'custom';
  // Hook positions relative to the piece's TOP-LEFT corner, in mm.
  // sawtooth: [{dx: w/2, dy: ~15}]
  // wire:     [{dx: w/2, dy: wireDropMm}]   (user-measured: top edge to taut-wire peak)
  // dring2:   [{dx: a, dy: d}, {dx: w - a, dy: d}]
  hooks: { dx: Mm; dy: Mm }[];
}

interface ArtPiece {
  id: string;
  name: string;
  widthMm: Mm;                 // OUTER size including frame (the size that occupies wall space)
  heightMm: Mm;
  shape: 'rect' | 'ellipse';   // MVP: rect only in UI; field exists for later
  image: BlobRef;              // rectified, cropped photo of the piece
  thumb: BlobRef;
  hang: HangSpec;
  status: 'idea' | 'owned' | 'planned' | 'hung' | 'storage';
  tags: string[];
  notes: string;
  measurement: {
    method: 'manual' | 'photo';
    confidence: 'high' | 'check' | 'low';
    spreadPct?: number;
    sourcePhoto?: BlobRef;
  };
  createdAt: number; updatedAt: number;
}

interface CalibrationRecord {
  method: 'measure' | 'measure2axis' | 'rect' | 'marker';
  measurements: { p: [number, number]; q: [number, number]; lengthMm: Mm }[]; // in rectified image px
  pxPerMm: number;              // isotropic after anisotropy correction
  anisotropy?: { sx: number; sy: number };  // px/mm per axis before correction
  gravity?: { betaDeg: number; gammaDeg: number; f35mm: number; fSource: 'exif' | 'default' };
  homography?: number[];        // 3x3 row-major, source px -> rectified px
  spreadPct: number;            // disagreement among measurements
  quality: 'good' | 'check' | 'poor';
}

interface ForegroundObject {
  id: string; label: string;
  mask: BlobRef;                // 8-bit PNG, same size as rectified wall image, 255 = object
  visible: boolean;
}

interface Wall {
  id: string; name: string;
  photo: { original: BlobRef; rectified: BlobRef; widthPx: number; heightPx: number };
  calibration: CalibrationRecord;
  bounds: { left: Mm; top: Mm; right: Mm; bottom: Mm };   // the actual wall surface within the image
  datums: { floorY?: Mm; ceilingY?: Mm };                 // optional marked lines
  foreground: ForegroundObject[];
  layouts: Layout[];
  createdAt: number; updatedAt: number;
}

interface Layout {
  id: string; name: string;
  placements: { pieceId: string; x: Mm; y: Mm; locked?: boolean }[]; // x,y = top-left in wall coords
  origin?: { style: ArrangeStyle; seed: number };
  createdAt: number; updatedAt: number;
}
```

Include an export/import format (`.hangplan.zip`: `data.json` + blobs) so users can back up and move devices. Version the schema and write migrations from day one.

---

## 5. Core geometry (the critical section)

Implement as pure TypeScript with exhaustive unit tests (§11). Everything in the UI depends on this being right.

### 5.1 The key insight

A single measurement can calibrate a whole photo only if the photo is (close to) a fronto-parallel view of the plane. The pipeline therefore is:

1. **Straighten** the photo as much as possible, preferably with phone gravity data (§5.2).
2. **Calibrate scale** from one user measurement (§5.3).
3. **Report quality** and offer optional refinement (§5.4, §5.5).

If a photo is rotated about the vertical axis relative to the wall ("yaw"), horizontal distances are foreshortened by about cos(yaw). Error table: 5° ≈ 0.4%, 10° ≈ 1.5%, 15° ≈ 3.4%, 20° ≈ 6%. Capture UX should keep users within ~10°, and the quality check (§5.4) catches the rest.

### 5.2 Gravity rectification (guided capture only)

Removes camera **pitch and roll** (not yaw), so vertical lines are vertical and the image is level.

- Read `deviceorientation` `beta` (β) and `gamma` (γ) at the moment of capture. Gravity direction in the device frame (W3C convention): `g_d = (cosβ·sinγ, −sinβ, −cosβ·cosγ)`.
- Convert to camera frame (x right, y down, z forward, back camera): `g_c = (g_d.x, −g_d.y, −g_d.z) = (cosβ·sinγ, sinβ, cosβ·cosγ)`. Sanity: phone upright in portrait (β=90°, γ=0) gives `g_c = (0,1,0)`.
- Handle screen orientation (`screen.orientation.angle`) by rotating the x/y components. MVP may lock guided capture to portrait and landscape separately, but both must be tested.
- Virtual camera axes expressed in the real camera frame: `y_v = normalize(g_c)`; `z_v = normalize(ẑ − (ẑ·y_v)·y_v)`; `x_v = y_v × z_v`. Let `R = [x_v y_v z_v]` (columns).
- Intrinsics `K` with focal length in pixels `f_px = (f35 / 43.267) · sqrt(w² + h²)`, principal point at image centre. `f35` comes from EXIF `FocalLengthIn35mmFilm` when available, else a default of 26 mm (typical phone main camera), as a named constant.
- Rectifying homography: `H = K · Rᵀ · K⁻¹`. Warp with `cv.warpPerspective`, computing output bounds from the transformed image corners; reject/clamp absurd bounds.
- **Verify the sign conventions on both an iPhone and an Android phone** with a "lay it flat, then hold it upright" self-test. Add a hidden debug screen that prints β, γ, and `g_c`. Platforms have historically differed here; this is the most likely place for an off-by-sign bug.
- Imported photos (no gravity data) skip this step; the user gets the manual refinement tools in §5.5 instead. Note that EXIF does not contain a gravity vector.
- Do not trust this blindly: guided capture should keep the phone close to upright (pitch within ±8°) so the correction is small and focal-length error is negligible. Ultra-wide lens frames are not supported (show a tip: "use the 1× camera").

### 5.3 Scale from one measurement

- UI: user taps/drags two endpoints on the (rectified) photo and types a length with a unit. Provide a magnifier loupe while dragging.
- `pxPerMm = |pq| / lengthMm`. The measurement can be any known length: wall width, ceiling height, door frame, an existing frame, a sheet of paper.
- Optional one-tap presets for the length field: *Credit card (85.60 mm)*, *US Letter (279.4 mm tall / 215.9 mm wide)*, *A4 (297 / 210 mm)*. These are just conveniences; no auto-detection.
- Multiple measurements allowed. Compute each implied scale `s_i`; use the median; `spreadPct = (max − min) / median · 100`.

### 5.4 Quality score

| spreadPct | quality | UI |
|---|---|---|
| ≤ 1.5% (or only one measurement + guided capture within tolerance) | good | green check, "±~1.5%" |
| 1.5–3.5% | check | amber, suggests adding a second measurement on the other axis |
| > 3.5% | poor | red, strongly suggests "Fix angle" (§5.5) |

With only one measurement there is no spread to measure. In that case, quality is derived from capture conditions: guided capture with small residual tilt → `good`; imported photo → `check` with the message "Add a second measurement on the other axis to verify".

### 5.5 Optional refinements

1. **Two-axis measurement.** If the user supplies one roughly horizontal (within 20°) and one roughly vertical measurement, compute `sx` and `sy` separately. Stretch the image in y by `sx/sy` so pixels per mm is equal in both axes. This corrects first-order foreshortening.
2. **Fix angle with a known rectangle.** The user drags four corners over any rectangle of known size (door frame, window, existing frame, a printed sheet) and enters its W×H. Compute a full homography (use OpenCV.js `getPerspectiveTransform`; do not hand-write a solver) mapping the quad to a W×H rectangle, warp the entire photo, and set scale from the known size. Objects not on the wall plane will distort; that's expected (see §6.4 on how cutouts stay consistent).
3. **(Stretch) Vanishing-point yaw estimate** from detected horizontal lines (baseboard, ceiling line) to suggest a yaw correction. Behind a feature flag. Do not ship if it is not clearly better than the manual tools.

### 5.6 Measuring art from a photo

- User lays one or more pieces flat on the floor (a plain, contrasting surface helps) and photographs from directly above using guided capture (level indicator shows when the phone is pointing straight down; this uses the same sensor data, with gravity along the camera's forward axis).
- **Reuse first:** adapt the quad-detection approach from `jscanify` or `opencv-document-scanner` (both MIT, OpenCV.js-based; they target a single sheet of paper, so extend to multiple quads) before writing your own.
- Detect candidate rectangles: grayscale, blur, adaptive threshold and/or Canny, `findContours`, `approxPolyDP`, keep convex 4-corner contours above a minimum area. Overlay them; the user can accept, drag corners, delete false positives, or add a quad manually.
- **Fallback:** tap-to-segment (§6.4's engine) on each piece, then fit a quad (`minAreaRect` or `approxPolyDP`).
- One measurement calibrates the shot (same §5.3 UI: tap an edge of any piece whose length is known). Optionally use presets (card, paper) if one is in the frame.
- For each accepted quad: warp to a rectangle, width = mean of the two horizontal edges, height = mean of the two vertical edges, converted by `pxPerMm`. Confidence: `high` if opposite edges differ ≤ 2% and corners are within 3° of right angles; `check` up to 5%; else `low`.
- Show the measured size next to a **snap suggestion** when within 1.5% of a common size (8×10, 11×14, 16×20, 18×24, 24×36 in; A5/A4/A3/A2; 20×30/30×40/50×70 cm). One tap accepts it. Always show editable numeric fields.
- Crop and rectify each piece into its own image for the inventory.

---

## 6. Features

### 6.1 Capture (guided + import) — wow #5

Two ways to bring in a photo:

- **Guided capture** (in-app, `getUserMedia`): live preview with a level overlay (bubble/line) driven by device orientation. Capture is enabled (or highlighted) only when the phone is within tolerance (±3° roll, ±8° pitch for walls; ±5° from straight-down for art on the floor). Records β, γ at the instant of capture. Request the highest practical resolution (e.g. `ideal` 4096×3072, accept what the device gives). Shows tips: "Stand back, centre the wall, keep the phone upright, use the 1× camera."
- **Use a photo** (`<input type=file accept="image/*">`, optionally with `capture`): gets the full-resolution native camera image, but no gravity data. User gets manual refinement tools.

Both paths feed the same pipeline. If motion permission is denied or unavailable, guided capture still works as a plain camera with a note.

**Acceptance:** On a real phone, a photo of a wall shot with the level overlay at ~5° of residual pitch is rectified so that a door frame's vertical edges are parallel to the image's vertical axis within 1°.

### 6.2 Wall creation flow — wow #2

1. Capture or import a wall photo.
2. (Guided only) automatic gravity rectification (§5.2). Show before/after toggle.
3. **Measure:** user draws one line and types its length (§5.3). Show running quality badge. Offer "Add second measurement" and "Fix angle".
4. **Wall bounds:** drag four edges to mark the actual wall surface (default: the image bounds). Optionally mark the **floor line** and **ceiling line** (used as datums and for eye-level guides).
5. **Foreground objects** (§6.4), optional, skippable.
6. Save. The wall opens in the editor with an empty layout.

Wall detail screen shows: name, calibrated size (e.g. "Wall: 118 × 96 in, ±1.5%"), layouts, edit-calibration button. Editing calibration after layouts exist must keep placements consistent (positions stored in mm; changing scale rescales the image, not the pieces, and warns the user).

**Acceptance:** On 5 real walls shot with guided capture, using one measurement of a known door or wall width, a second independently tape-measured length on the same photo is within 2% for at least 4 of 5 walls.

### 6.3 Art inventory (library)

- Grid/list of pieces with thumbnail, name, size, status. Search, filter by status/tag, sort by size or date.
- **Add art** paths: (a) photo of one or many pieces on the floor (§5.6), (b) enter dimensions manually and optionally attach a photo (a flat photo is stretched to the entered aspect ratio after the user confirms the four corners), (c) duplicate an existing piece.
- Per-piece editor: name, W×H, hang type + hook geometry (presets with editable numbers; wire: ask "distance from top edge to the top of the wire when pulled taut"), status, tags, notes.
- Bulk edit status. Delete requires confirmation (and warns if the piece is used in layouts).
- Piece photo is used as the on-canvas texture. If the user adds no photo, render a neutral labelled rectangle.

**Acceptance:** Adding 6 pieces from one floor photo takes under 90 seconds including one typed measurement, with no more than 1 manual corner fix on average across 5 test photos.

### 6.4 Foreground cutouts — wow #1

Goal: mark things in front of the wall (TV, lamp, plant, sofa back) so art can be placed partly behind them in the preview.

- Tool: **"Mark object in front of wall"** on the wall photo (rectified image).
- **Tap-to-segment:** tap the object to get a mask. Additional taps are positive (include) or negative (exclude) via a toggle. Optional box prompt (drag a rectangle). Shows a live mask overlay. Accept to save.
- **Manual tools (always available, also the fallback if the model is unavailable):** rectangle with 4 draggable corners (works well for TVs and frames), polygon/lasso, and a brush with add/erase modes.
- Mask cleanup: morphological open/close, fill holes, 1–2 px feather on the edge. Store as an 8-bit PNG at the rectified wall image's resolution.
- **Rendering order (editor and exports):** (1) wall photo, (2) art pieces, (3) wall photo again, clipped by the foreground mask(s). Result: art appears behind the object using real photo pixels.
- Each object has a name, visibility toggle, and delete. The editor shows an unobtrusive chip when a piece overlaps an object ("Partly behind: TV").
- Because masks are defined in the same rectified image as the photo, any warping applied to the photo is applied to the masks identically, so they stay aligned. Do not use foreground objects as measurement references; they're closer to the camera than the wall.

**Model delivery (reuse first, §0A):**
- Use Transformers.js (`SamModel`, `AutoProcessor`) with a SlimSAM model; its processor handles input resizing and mask post-processing. Start from the public "segment-anything-webgpu" demo code. Do not hand-roll an ONNX pipeline unless the M0.5 spike shows this path fails on iPhone Safari. On iPhone, verify WebGPU availability; default to the small INT8 WASM variant (about 14 MB) if it is missing.
- Download lazily on first use, after showing the size and getting a tap to confirm; cache in Cache Storage; works offline afterwards.
- Run the image encoder once per photo (input resized to the model's required size, e.g. 1024 long edge), cache the embedding in memory for that session, and run the lightweight decoder per tap. Upscale the mask back to the photo's resolution.
- Use WebGPU if available, else WASM. Show a progress indicator for the encoder step. Target ≤ 5 s encoder time on a recent mid-range phone, decoder ≤ 300 ms per tap. If slower, the manual tools remain the primary path.
- Run in a worker. Release the session when leaving the tool to save memory.

**Acceptance:** On 5 real photos, tapping a TV yields a mask whose boundary is within ~1% of the image width of the true outline after ≤ 3 taps; a piece placed half behind it renders correctly with no visible halo at 2× zoom.

### 6.5 Layout editor (canvas)

- Konva stage showing the rectified wall photo at true scale, with the wall bounds highlighted. Pan (one finger on background), pinch-zoom, double-tap to fit.
- **Add pieces** from a bottom sheet of the inventory; drag onto the wall. Drag to move; handles are not needed for resizing (sizes are real).
- **Reuse:** start from Konva's official "Objects Snapping" example (edges, centres, guide lines) or the `use-konva-snapping` hook. Neither covers equal-gap snapping or datum snapping; those are the parts to write.
- **Snapping and guides** (toggleable): snap to other pieces' edges and centres, to the wall's centre lines, to the floor/ceiling datums, and to a grid. **Equal-gap detection:** when the gap between a piece and its neighbour equals a gap elsewhere in the layout, snap and show gap labels (like Figma's smart guides). Snap distance is in screen pixels, not mm.
- **Precision:** selecting a piece shows exact position (distance from left wall edge and from floor/ceiling, in the user's units) with numeric entry, plus nudge buttons (1/8 in or 1 mm; hold for repeat).
- **Measurement overlay** toggle: shows distances to neighbours and to datums.
- Align/distribute tools (left/centre/right/top/middle/bottom, distribute horizontal/vertical with equal gaps), lock piece, duplicate, remove from layout, multi-select (long-press or a select mode).
- **Undo/redo** (command stack, ≥ 50 steps).
- **Multiple layouts per wall:** create, rename, duplicate, delete. A **compare view** flips between two layouts (swipe or toggle) at the same zoom. Autosave on every change (debounced).
- **Eye-level guide:** optional horizontal guide at a default of 57 in (145 cm) above the floor, adjustable; only available if a floor line was marked.
- **Performance:** 60 fps while dragging with 30 pieces and 3 masks on a mid-range phone. Cache the masked-photo top layer as a single bitmap; do not recompute during drags.

**Acceptance:** Place, align, and equal-gap 6 pieces on a wall in under 2 minutes by an unassisted first-time tester; undo/redo is reliable; positions after reload are identical.

### 6.6 Auto-arrange — wow #4

Pure geometry, no AI imagery. Runs in a worker, deterministic given a seed.

```ts
type ArrangeStyle = 'grid' | 'row' | 'column' | 'salon' | 'centered-on-guide';

interface ArrangeInput {
  wall: { width: Mm; height: Mm; margins: Mm };       // usable area
  pieces: { id: string; w: Mm; h: Mm; locked?: { x: Mm; y: Mm } }[];
  keepOut: { x: Mm; y: Mm; w: Mm; h: Mm }[];          // optional (user can choose to avoid foreground objects)
  style: ArrangeStyle;
  gap: Mm;                                            // default ~50 mm / 2 in
  guideX?: Mm;                                        // vertical centre line (e.g. centred over a sofa)
  centerY?: Mm;                                       // target visual centre (e.g. eye level)
  align: 'center' | 'top' | 'bottom' | 'left' | 'right';
  seed: number;
}
type ArrangeResult = { placements: { id: string; x: Mm; y: Mm }[]; score: number }[];
```

- **Reuse:** use `maxrects-packer` (MIT) as the packing engine for the grid/salon candidates, then centre, score and rank in our own code. Do not write a packer.
- Return N (default 6) ranked variants; "Shuffle" produces new variants with new seeds. User taps one to apply to the current layout (undoable, respecting locked pieces).
- **Grid:** choose rows×cols to best fit the aspect ratio; uniform gaps; align by centres/top edges within rows.
- **Row/column:** centred on `guideX` / `centerY` with the chosen alignment line.
- **Salon:** pick a "hero" (largest piece, or user-selected) near the visual centre; pack remaining pieces around it using a skyline or MaxRects-style packer with constant gaps; try multiple orderings per seed; centre the final bounding box on the target.
- **Scoring (weights are tunable constants, covered by tests):** fits inside usable area (hard constraint), avoids keep-out zones (hard constraint), bounding-box aspect ratio near the wall's, visual-weight balance (area-weighted centroid near the target centre), uniformity of gaps, fraction of pieces edge-aligned, margin to wall edges.
- Time budget: ≤ 500 ms for ≤ 20 pieces. Show a progress state otherwise.
- **"Which pieces fit this wall?":** in the add-pieces sheet, offer a filter showing only pieces that fit within the wall's usable area, and a "Suggest a set" action that selects a subset whose total area is ~35–50% of the wall area (a common rule of thumb; make it a constant).

**Acceptance:** For 8 mixed-size pieces on a 3 m × 2.4 m wall, each style returns ≥ 3 valid variants (no overlaps, inside bounds) in < 500 ms; property-based tests confirm no overlaps/out-of-bounds across 1,000 random inputs.

### 6.7 Hang guide & exports

- **Datum selection:** measure from *left wall edge* and from *floor* or *ceiling* (only datums that were marked are available). Show the choice on the export screen.
- **Hook positions:** for each piece, `hookWall = piece.topLeft + hook.(dx, dy)`. A piece with two hooks lists both. Convert to datum-relative coordinates in the user's units (imperial rounded to 1/16 in with a fraction display; metric to 1 mm). Include per-piece "level between hooks" for two-hook pieces.
- **PDF export** (`pdf-lib`; no off-the-shelf JS "tile a drawing at 1:1" library turned up, and the logic is small: compute a tile grid and draw the same vector geometry on each page with an offset), with a Letter/A4 setting:
  1. **Overview page:** wall photo with the layout composited (including cutout masking) and a legend.
  2. **Coordinates table:** piece, size, hook positions from the chosen datum.
  3. **1:1 templates:** each piece's outline at exactly 100% scale, tiled across pages if larger than a sheet (10 mm overlap, registration crosses, "page 2 of 4" labels), hook crosshairs marked and labelled, piece name in the corner. The first page includes a **scale check square** (e.g. 50 mm / 2 in) and the instruction "Print at 100% / Actual size".
- **Image export:** PNG of the composite for sharing (Web Share API on mobile, download on desktop).
- Mark pieces as `hung` from the export screen (optional).

**Acceptance:** Print a template at 100%; the scale-check square measures within 1 mm. Hanging a test piece from the generated hook coordinates lands within 3 mm of the preview position on a real wall (manual QA, documented with photos in `docs/qa/`).

### 6.8 Live "ghost" overlay — wow #3 (stretch; behind a feature flag)

Show the planned layout through the live camera at true position on the actual wall, including markers for nail locations.

- **Approach: fiducial markers as anchors** (reliable on blank walls). Use an existing detector (`aruco-rs`, `apriltag-js-standalone` or `js-aruco2`, chosen in the M0.5 spike); do not write one. `EdwardLu2018/wasm-ar` is prior art for the markerless variant.
  1. App generates a printable marker sheet (one or more markers at a known printed size; user measures one printed edge and enters it to correct for printer scaling).
  2. User tapes 1–4 markers on the wall (ideally near opposite corners of the planned area) **before** capturing the wall photo in §6.2.
  3. During wall creation, the app detects the markers in the photo. Each marker's four corners give correspondences in wall-plane coordinates, and a marker's known edge length **also provides the calibration measurement automatically**, so the user types nothing.
  4. In live mode, detect the markers in each video frame, compute the homography from the wall plane to the frame using all visible marker corners (≥ 8 correspondences with 2+ markers), and draw the layout (pieces, hooks, labels) using that homography on a canvas over the video.
- Smoothing (e.g. a One-Euro filter on homography parameters or corner positions) to limit jitter. Show "tracking lost" state clearly and fade the overlay.
- Accuracy note for the UI and docs: with a single small marker, error grows with distance from the marker; recommend 2+ markers spread across the area.
- Optional later experiment (not in this spec): markerless tracking by matching features of the live frame to the saved wall photo.
- Provide a "freeze frame" button to save a still of the overlay for sharing.

**Acceptance:** With two 120 mm markers placed ~1.5 m apart, overlay hook marks stay within 5 mm of tape-measured positions at a viewing distance of ~2 m, with visible jitter under 2 px at 30 fps on a recent iPhone and Android phone.

### 6.9 Sweep video for wide walls — wow #6 (v2; start with a spike)

- UI: record a slow sideways pan (the phone translates along the wall, staying roughly parallel to it), sampling frames at intervals.
- For a planar scene, frame-to-frame relations are homographies. Estimate them with feature matching (ORB + RANSAC), chain to a reference frame, warp, and blend with seam-aware blending. Use sensor data only for sanity checks.
- Reuse first. OpenCV's Stitcher has a SCANS mode meant for flat scenes, but the stitching module is not in the default OpenCV.js build and custom builds are reported as fiddly. The spike compares: (1) a custom OpenCV.js build with stitching, (2) a minimal in-house pipeline (ORB, matcher, homography, warp, feathered blend; `latsic/imgalign` is a reference), (3) dropping the feature.
- Output goes through the same pipeline as a single photo (calibrate with a measurement, quality check). Warn that errors accumulate along the wall and recommend measuring a length near each end (two measurements → anisotropy/scale consistency check).
- Spike goal: decide go/no-go. **Acceptance for the spike:** stitch a 4 m wall from a 20 s pan with a seam error under 2% of wall width and no visible ghosting on a textured wall; document failures (blank walls, glare) in `docs/stitch-notes.md`.

---

## 7. Screens & navigation

Bottom tab bar: **Walls · Art · Settings**.

- **Walls:** list of walls → wall detail (calibration summary, layouts) → editor.
- **Art:** inventory grid → piece detail; "+" opens Add art (photo / manual / duplicate).
- **Settings:** units, default hang type, snap preferences, eye-level default, model download/cache management, export/import data, camera tips, "about accuracy".
- **Onboarding (3 screens max):** (1) what the app does, (2) how to take a good wall photo, (3) how measuring works (one number). Skippable; re-openable from Settings.
- Empty states for every list with a clear single action.
- Accessibility: touch targets ≥ 44 px, readable contrast, labelled controls, respects reduced motion. All numeric entries have visible units.
- Copy tone: plain and calm. Always show where a size came from ("measured from photo, ±1.5%" or "typed by you").

---

## 8. Non-functional requirements

- **Privacy:** no network calls with user images or data. The only network requests are static assets and the optional model download. No third-party analytics that touch image or measurement data. Any telemetry must be opt-in, anonymous, and documented.
- **Offline:** after first load (and model download if used), all features except the first model download work offline.
- **Performance:** cold load < 3 s on 4G for the core shell (lazy-load OpenCV.js and the model). Editing images capped at 3000 px long edge on mobile (originals kept as separate blobs; configurable). Memory safe on 4 GB phones: free canvases and ONNX sessions when leaving tools.
- **Data safety:** autosave; schema versioning with migrations; import validates and never overwrites without confirmation.
- **Error handling:** every failure has a message and a manual fallback (camera denied → import; motion denied → manual tools; model fails → manual cutout; CV fails to detect rectangles → manual quad).

---

## 9. Milestones & acceptance criteria

**M0 — Scaffold.** Vite + TS strict, PWA shell, tab navigation, Dexie schema with migrations, Settings (units), test setup, CI script running lint, type check, unit tests. *Done when:* installable PWA runs on a phone over HTTPS; schema migration test passes.

**M0.5 — Prior-art spikes (time-boxed, before any feature work).** One small throwaway page per item, each tested on a real iPhone and a real Android phone, each ending with a go/no-go line in `DECISIONS.md`:
1. Segmentation: Transformers.js + SlimSAM tap-to-mask on a wall photo downscaled to the model's input size; record encoder and decoder times and memory on both phones; check WebGPU on iOS Safari and the WASM fallback.
2. OpenCV.js: confirm which functions the build exposes (`getPerspectiveTransform`, `warpPerspective`, `findHomography`, Canny, contours); measure load size and time; decide between the official build, `cv-homography`, or a custom build.
3. Quads: run the `jscanify` / `opencv-document-scanner` approach on 5 floor photos of art; record the detection rate with several pieces per photo.
4. Markers (only if M9 is planned soon): compare `aruco-rs`, `apriltag-js-standalone` and `js-aruco2` on a live video stream: detection rate, corner accuracy, fps.
*Done when:* every spike has a go/no-go entry and `THIRD_PARTY.md` lists each adopted dependency with its license.

**M1 — Geometry core + art inventory (manual).** `geometry/` modules with unit tests; art library CRUD, manual dimensions, hang specs, units conversion/fractions. *Done when:* all geometry tests pass; entering 10 pieces and reloading preserves everything.

**M2 — Guided capture + wall calibration.** Capture screen with level overlay, sensor permission flow, gravity rectification, one-measurement calibration, quality badge, two-axis and rectangle refinements, wall bounds and datums. *Done when:* the acceptance test in §6.2 passes on real walls; the debug screen confirms sensor sign conventions on iOS and Android.

**M3 — Layout editor.** Canvas, drag, snapping, equal gaps, numeric position, nudge, align/distribute, undo/redo, multiple layouts, compare. *Done when:* §6.5 acceptance passes; 60 fps drag test on a mid-range phone.

**M4 — Art from photo.** Floor photo capture, rectangle detection, quad editing, calibration, per-piece rectification, snap suggestions. *Done when:* §6.3 acceptance passes.

**M5 — Foreground cutouts.** Manual tools first (rectangle, polygon, brush), then tap-to-segment with lazy model download, layered rendering. *Done when:* §6.4 acceptance passes.

**M6 — Auto-arrange.** Solver in a worker, five styles, variants and shuffle, fit filter. *Done when:* §6.6 acceptance and property tests pass.

**M7 — Hang guide & exports.** Datum selection, hook math, PDF with overview, table, and 1:1 tiled templates, PNG export. *Done when:* §6.7 acceptance passes with printed proof.

**M8 — Polish & release candidate.** Onboarding, empty states, accessibility pass, data export/import, performance pass, README with setup and architecture notes.

**M9 (stretch) — Ghost overlay.** §6.8, behind a feature flag.

**M10 (v2 spike) — Sweep stitching.** §6.9 spike with go/no-go write-up.

---

## 10. Testing & accuracy protocol

### Unit tests (Vitest, `geometry/`)
- Homography wrappers: recover a known transform from noisy points; inverse round-trips.
- Gravity rectification: synthetic scene (known wall grid) rendered through a virtual camera with known pitch/roll, rectified, then verify grid lines are parallel/axis-aligned within tolerance.
- Calibration: scale fit, spread computation, two-axis anisotropy recovery from synthetic foreshortening.
- Quad metrics and confidence thresholds.
- Layout solver: property-based tests (no overlaps, inside bounds, keep-outs respected, deterministic for a given seed).
- Hook math: all hang types, datum conversion, fraction rounding.
- Unit conversion and fraction formatting (e.g. 11 7/16 in, never "11 7/16" mixed with decimals).

### Synthetic image tests
Generate images of a known grid/rectangles with a known homography applied plus noise and blur. Run the real pipeline (including OpenCV.js detection) and assert measured dimensions within the spec tolerance. Store generators and fixtures in `tests/fixtures/`.

### E2E (Playwright, WebKit + Chromium mobile profiles)
Flows: add art manually; create a wall from a fixture image with a typed measurement; place and snap pieces; undo/redo; generate and apply an auto-arrange; export PDF (assert page count and text). Camera and sensor flows use fake media streams and mocked orientation events.

### Real-world accuracy protocol (manual, documented in `docs/qa/`)
For each of ≥ 5 walls and ≥ 12 art pieces: photograph with guided capture; calibrate with one measurement; record the app's size for a second, independently tape-measured length; compute % error. Report median and worst-case. Targets: median ≤ 1.2%, worst case ≤ 3% for guided capture; ≤ 4% for imported photos with a second measurement.

---

## 11. Out of scope for this version

- Any AI-generated or AI-modified imagery (style transfer, inpainting, "realistic rendering").
- 3D room models, 360° rooms, LiDAR/ARKit/WebXR measurement.
- Accounts, cloud sync, sharing links, collaboration.
- Shopping, frame retail, or price features.
- Non-rectangular art in the UI (the `shape` field exists; ellipses are a possible follow-up).
- Sloped ceilings, curved walls, wall textures/colour matching.

---

## 12. Risks & open questions

| Risk | Mitigation |
|---|---|
| Phone sensor conventions differ across iOS/Android | Debug screen, self-test, fixtures from both platforms, unit tests for the conversion |
| Single measurement is inaccurate when the photo is angled (yaw) | Capture tips, quality score, two-axis and rectangle refinements |
| Segmentation model too big/slow on low-end phones | Lazy download with size shown, manual cutout tools as the primary fallback, WebGPU when available |
| Camera resolution via `getUserMedia` is lower than the native camera on some devices | Offer "Use a photo" path; document the trade-off (full res vs. gravity data) |
| Blank or glossy walls break feature-based tracking/stitching | Markers for the ghost overlay; stitching is a spike with a go/no-go |
| Printing at the wrong scale breaks templates | Scale-check square on every export; instruction text |
| OpenCV.js bundle size | Lazy-load; consider a custom minimal build |

**Decisions made (change if you disagree):** local-first with no backend; PWA instead of a native app for v1; manual cutout tools ship before the model; markers (not markerless tracking) for the ghost overlay; presets for card/paper in the measurement field instead of auto-detecting reference objects.

**Open questions for the product owner:**
1. Final product name?
2. Default units: US imperial with fractions, metric, or locale-based (current default)?
3. Is a future cloud backup/sync desirable? (If so, keep the export format stable now.)
4. Should the app later support measuring several walls into one "room" for cross-wall consistency?
