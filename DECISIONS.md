# Decisions log

Deviations from the spec (`docs/SPEC.md`), and choices the spec left open. Newest last.

## M0 — Scaffold

- **UI framework: React 19 + Zustand.** Spec default; Svelte not used.
- **Routing: a ~20-line hash router (`src/app/router.ts`) instead of a routing library.** Three
  tabs don't need one, and hash routes work on any static host with no rewrite rules. Revisit when
  nested routes (wall → layout editor) arrive in M2/M3.
- **TypeScript pinned to 5.9.x.** TypeScript 7 (native port) is current, but the lint toolchain
  (typescript-eslint) is built against the 5.x compiler API. Revisit once it officially supports 7.
- **Local HTTPS: `@vitejs/plugin-basic-ssl`, enabled with `HTTPS=1 npm run dev`.** It generates a
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
- **`npm audit` reports 4 moderate advisories** in `glob`/`minimatch` pulled in by
  `vite-plugin-pwa` → `workbox-build`. Build-time only, never shipped to the browser; the only "fix"
  downgrades vite-plugin-pwa to 1.x. Accepted for now; recheck on each dependency update.
- **Secret scanning:** gitleaks runs in CI on every push and PR, in addition to the broad
  `.gitignore`. The app has no backend and needs no secrets; `.env.example` documents that.

## Not yet verified (needs a real device)

- M0 "installable PWA runs on a phone over HTTPS": verified in desktop Chromium with mobile
  emulation (service worker registers, manifest valid, settings persist across reload). Still needs a
  check on a real iPhone (Safari, Add to Home Screen) and Android phone (Chrome install prompt).
