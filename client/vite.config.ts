import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => {
  const configuredBase = (process.env.CREATOR_BASE_PATH || '/').trim();
  if (!configuredBase.startsWith('/') || configuredBase.startsWith('//') || /[?#\\]/.test(configuredBase)) {
    throw new Error('CREATOR_BASE_PATH must be an absolute URL path, for example /creator-platform/');
  }
  return {
    root: 'client',
    // Local Vite development stays at /; production can share a domain under a subpath.
    base: command === 'serve' ? '/' : `${configuredBase.replace(/\/+$/, '')}/`,
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
  };
});
