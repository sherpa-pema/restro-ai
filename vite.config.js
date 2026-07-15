import { defineConfig } from 'vite';
import dns from 'node:dns';

// Fix Node.js DNS resolution issues on Windows
dns.setDefaultResultOrder('ipv4first');

export default defineConfig({
  root: '.',
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/ai': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/print': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
