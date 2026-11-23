# Third-party code and dependencies

Only permissive licenses (MIT, Apache-2.0, BSD, ISC or similar). No GPL/AGPL, no unlicensed code.
Snippets copied from other projects are listed here with their source and license.

## Runtime dependencies

| Package | License | Purpose |
|---|---|---|
| react, react-dom | MIT | UI |
| zustand | MIT | State store |
| dexie | Apache-2.0 | IndexedDB wrapper |
| dexie-react-hooks | Apache-2.0 | Live queries in React |
| konva, react-konva | MIT | Layout editor canvas |
| @techstark/opencv-js (OpenCV 4.12) | Apache-2.0 | Rectangle detection, perspective transforms and warps (in a Web Worker) |
| workbox-window (via vite-plugin-pwa) | MIT | Service worker registration |

## Build and test tooling (not shipped)

| Package | License |
|---|---|
| vite, @vitejs/plugin-react, @vitejs/plugin-basic-ssl | MIT |
| vite-plugin-pwa | MIT |
| typescript | Apache-2.0 |
| vitest | MIT |
| fake-indexeddb | Apache-2.0 |
| fast-check | MIT |
| @playwright/test | Apache-2.0 |
| jsdom | MIT |
| @testing-library/react | MIT |
| eslint, @eslint/js, typescript-eslint, eslint-plugin-react-hooks, globals | MIT |

## Copied snippets / adapted approaches

- Edge and centre snapping in `src/geometry/layout/snap.ts` follows the approach of Konva's
  "Objects Snapping" demo (MIT); rewritten as pure functions, no code copied.
- Rectangle detection in `src/cv/detect.ts` adapts the approach of `jscanify` and
  `opencv-document-scanner` (both MIT): edges → contours → polygon approximation. Extended for
  multiple pieces; no code copied.
- Pinch-zoom in `src/features/editor/WallCanvas.tsx` follows Konva's "Multi-touch scale stage"
  demo (MIT); rewritten, no code copied.
