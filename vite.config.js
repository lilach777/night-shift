import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built game works from any sub-folder (itch.io, GitHub Pages, S3...).
  base: './',
  build: {
    target: 'es2022',
    // three.js + the layout data make one ~0.9 MB (225 KB gzip) bundle; that's expected.
    chunkSizeWarningLimit: 1200,
    assetsInlineLimit: 0,
  },
  server: { port: 5173 },
});
