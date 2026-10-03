import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4317,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:4318',
      '/uploads': 'http://127.0.0.1:4318',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
