import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The screen is served by the same server as the API, so in development the
 * proxy stands in for that: `/api` and `/health` go to the running server and
 * everything else is served from here.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/health': { target: 'http://localhost:8787', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
  },
});
