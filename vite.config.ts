import { defineConfig } from 'vite';

// Relative base so the build works from any static host (itch.io, GitHub Pages, a sub-folder…)
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  server: { host: true },
});
