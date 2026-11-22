# HangPlan (working title)

A mobile-first PWA for planning wall-art arrangements from real photos and real dimensions.
Local-first: no account, no backend, photos never leave the device. No generative AI imagery.

Full spec: [`docs/SPEC.md`](docs/SPEC.md). Deviations and open choices: [`DECISIONS.md`](DECISIONS.md).
Dependency licenses: [`THIRD_PARTY.md`](THIRD_PARTY.md).

## Status

| Milestone | State |
|---|---|
| M0 Scaffold | Done (pending real-device check, see DECISIONS.md) |
| M0.5 Prior-art spikes | Not started — needs a real iPhone and Android phone |
| M1+ | Not started |

## Develop

Requires Node 22+.

```sh
npm install
npm run dev          # http://localhost:5173
npm run ci           # lint + typecheck + unit tests + production build
```

### Testing on a real phone

Camera, motion sensors and the service worker all need HTTPS. Two options:

**A. Tunnel (recommended; trusted certificate, PWA install works, any network)**

```sh
npm run build && npx vite preview          # or: npm run dev
cloudflared tunnel --url http://localhost:4173   # 5173 for dev
```

Open the printed `https://<random>.trycloudflare.com` URL on the phone. Install cloudflared with
`brew install cloudflared` (macOS) or see Cloudflare's docs. Quick tunnels need no account. The URL is
public while the tunnel runs, so stop it (Ctrl-C) when you're done.

**B. Same Wi-Fi, self-signed certificate (no extra tools)**

```sh
npm run dev:host        # https://<your-LAN-IP>:5173, live reload
npm run build && npm run preview:host   # https://<your-LAN-IP>:4173, production build
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
