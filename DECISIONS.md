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
