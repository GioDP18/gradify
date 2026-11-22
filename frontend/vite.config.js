import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true, // must match CLIENT_URL in backend/.env (origin check)
    // Same-origin API in development, mirroring the Vercel rewrite in production.
    proxy: {
      '/api': { target: process.env.VITE_DEV_API_TARGET || 'http://localhost:5000', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
    // jsdom workers are memory-hungry; more than two crashed (exit 134) on an 8 GB machine.
    maxWorkers: 2,
    env: {
      VITE_API_URL: '/api',
    },
  },
});
