import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * `electron-vite dev` only. The shipped policy in src/renderer/index.html forbids inline scripts
 * and every connection, which blocks two things the Vite dev server needs: the React Fast Refresh
 * preamble (an inline <script>) and the HMR websocket. While serving, this swaps the meta tag's
 * policy for a dev-only one. `electron-vite build` never runs it (apply: 'serve'), so the built
 * index.html keeps the strict policy verbatim; src/main/index.ts likewise skips its CSP header in dev.
 */
const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self'; connect-src 'self' ws://localhost:* http://localhost:*";

const devCsp = {
  name: 'paddock:dev-csp',
  apply: 'serve' as const,
  transformIndexHtml(html: string): string {
    return html.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/, `$1${DEV_CSP}$2`);
  },
};

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias: { '@shared': resolve('src/shared') } } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias: { '@shared': resolve('src/shared') } } },
  renderer: {
    plugins: [react(), devCsp],
    resolve: { alias: { '@shared': resolve('src/shared'), '@': resolve('src/renderer') } },
  },
});
