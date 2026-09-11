import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {},
  preload: { build: { rollupOptions: { output: { inlineDynamicImports: true } } } },
  renderer: { plugins: [react(), {
    name: 'development-refresh-policy',
    apply: 'serve',
    transformIndexHtml(html) {
      // React Refresh injects an inline preamble during development only.
      return html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';");
    },
  }] },
});
