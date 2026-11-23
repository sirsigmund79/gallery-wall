/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  // `--mode lan` (npm run dev:host / preview:host) serves over HTTPS with a
  // throwaway self-signed certificate and exposes the server on the LAN, for
  // testing camera and motion sensors on a real phone. Uses a CLI flag rather
  // than an env var so it works in every shell, including Windows cmd/PowerShell.
  // The certificate is generated locally and is never committed.
  const useHttps = mode === 'lan';

  // Also accept requests forwarded by a cloudflared quick tunnel.
  const network = {
    host: useHttps ? true : undefined,
    allowedHosts: ['.trycloudflare.com'],
  };

  return {
    plugins: [
      react(),
      ...(useHttps ? [basicSsl()] : []),
      VitePWA({
        registerType: 'autoUpdate',
      // Icons are already matched by workbox.globPatterns; don't list them twice.
      includeManifestIcons: false,
        manifest: {
          name: 'HangPlan',
          short_name: 'HangPlan',
          description: 'Plan wall-art arrangements from real photos and real dimensions.',
          theme_color: '#1f2933',
          background_color: '#f7f5f2',
          display: 'standalone',
          orientation: 'any',
          start_url: '.',
          scope: '.',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png}'],
        },
      }),
    ],
    server: network,
    preview: network,
    test: {
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
      setupFiles: ['tests/setup.ts'],
    },
  };
});
