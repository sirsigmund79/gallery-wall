# HangPlan (working title)

A mobile-first PWA for planning wall-art arrangements from real photos and real dimensions.
Local-first: no account, no backend, photos never leave the device. No generative AI imagery.

Full spec: [`docs/SPEC.md`](docs/SPEC.md). Deviations and open choices: [`DECISIONS.md`](DECISIONS.md).
Dependency licenses: [`THIRD_PARTY.md`](THIRD_PARTY.md).

## Status

| Milestone | State |
|---|---|
| M0 Scaffold | Done (pending real-device check) |
| M0.5 Prior-art spikes | Deferred: needs a real iPhone and Android phone |
| M1 Geometry + art library | Done |
| M2 Wall calibration | Mostly done: photo import, measurements, quality, two-axis, edges, floor/ceiling. Guided capture and "fix angle" pending |
| M3 Layout editor | Core done: drag, snapping incl. equal gaps, exact positions, nudge, undo/redo, layouts. Align/distribute and compare pending |
| Hang guide | Basic printable nail table (PDF templates are M7) |
| M4 Art from photo | Done: multi-piece detection, corner editing, reference sizing, crops, standard-size suggestions. Needs real-photo QA |
| Guided capture (gyro) | Done for walls and art; needs sign-convention check on real iPhone/Android (Settings → Sensor check) |
| M6 Auto-arrange | Done: Suggest (mix from library / rearrange), row/grid/salon/symmetric, shuffle, keep-outs |
| Rooms & Home | Done: rooms, swipeable wall cards, step-in transition, prev/next wall |
| M5, M7+ | Not started (cutouts, PDF templates, ghost overlay, stitching) |

### What you can do today

1. **Art → Scan art:** photograph art laid on the floor *or* already hanging on a wall (the level
   guide switches by itself to match how you hold the phone), tap one you
   know the size of (or a sheet of paper or a card in the photo) and enter it. Every piece is
   measured, cropped and straightened. Or **Add by hand** with a typed size.
2. **Home → Add a wall:** photograph it, tap a door (or anything you know the size of) and pick its
   size; the floor is found for you ("Measure a line instead" works too). Or, after scanning art
   hanging on a wall, tap **Plan this wall**. Walls are grouped into rooms on Home.
3. **Suggest** proposes layouts that fit (from your whole library, or rearranging what's up), or
   **Add art** yourself and drag pieces around (they snap to edges, centres and equal gaps), or
   type exact positions.
4. **Hang guide:** where each nail goes, measured from the wall's left edge and the floor.

## Develop

Requires Node 22+.

```sh
npm install
npm run dev          # http://localhost:5173
npm run ci           # lint + typecheck + unit tests + production build
npm run e2e          # end-to-end tests (Playwright; run `npx playwright install` once)
```

### Testing on a real phone

Camera, motion sensors and the service worker all need HTTPS. Two options:

**A. Tunnel (recommended; trusted certificate, PWA install works, any network)**

```sh
npm run build
npx vite preview                      # or: npm run dev (port 5173)
cloudflared tunnel --url http://localhost:4173   # 5173 for dev
```

Open the printed `https://<random>.trycloudflare.com` URL on the phone. Install cloudflared with
`winget install --id Cloudflare.cloudflared` (Windows; open a new terminal afterwards),
`brew install cloudflared` (macOS), or see Cloudflare's docs for Linux. Quick tunnels need no account. The URL is
public while the tunnel runs, so stop it (Ctrl-C) when you're done.

**B. Same Wi-Fi, self-signed certificate (no extra tools)**

```sh
npm run dev:host        # https://<your-LAN-IP>:5173, live reload
npm run build
npm run preview:host    # https://<your-LAN-IP>:4173, production build
```

Open the "Network" URL Vite prints and accept the certificate warning (iOS: *Show Details → visit
this website*). Camera and sensors work, but browsers usually refuse to register a service worker
on an untrusted certificate, so use option A to test installing or offline use.
[mkcert](https://github.com/FiloSottile/mkcert) with its root CA installed on the phone is a third option.

Certificates, keys and tunnel configs are git-ignored. Never commit them.

## Layout

```
src/
  app/        App shell, tab router
  domain/     Domain types (spec §4)
  geometry/   PURE TypeScript (no DOM), fully unit-tested
  db/         Dexie schema + versioned migrations
  state/      Zustand stores
  features/   walls/ art/ settings/ …
  ui/         Shared components
tests/        Test setup and fixtures
```

## Security and privacy

This is a public repository. Never commit secrets, keys, certificates, or real photos of homes.
`.gitignore` blocks the common cases and CI runs gitleaks on every push. The app itself needs no
secrets; see `.env.example`.
