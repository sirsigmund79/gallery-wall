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

Camera and motion sensors need HTTPS. On the same Wi-Fi as your computer:

```sh
HTTPS=1 npm run dev  # serves https://<your-LAN-IP>:5173 with a throwaway self-signed cert
```

Accept the certificate warning on the phone once. Alternatives: [mkcert](https://github.com/FiloSottile/mkcert)
(install its root CA on the phone) or a tunnel such as `cloudflared tunnel --url http://localhost:5173`.
Certificates, keys and tunnel configs are git-ignored — never commit them.

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
