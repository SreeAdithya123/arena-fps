import { defineConfig } from 'vite';

// In dev, room APIs and WebSockets proxy to `wrangler dev` on 8787.
// In production one Worker serves both the static build and the rooms.
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
