import { defineConfig } from 'vite';
import dns from 'node:dns';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Fix Node.js DNS resolution issues on Windows
dns.setDefaultResultOrder('ipv4first');

export default defineConfig({
  root: '.',
  plugins: [basicSsl()],
  server: {
    port: 3000,
    host: '0.0.0.0',
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
