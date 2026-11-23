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
| M4+ | Not started |

### What you can do today

1. **Art → Add art:** name, outer size (e.g. `16` × `20`, or `24 1/2`), hanger type.
2. **Walls → Add a wall:** take or choose a photo, drag the red line over something you know the
   length of (door width, wall width, a sheet of paper), type it. Optionally mark the floor.
3. **Add art** onto the wall, drag pieces around (they snap to edges, centres and equal gaps), or
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
