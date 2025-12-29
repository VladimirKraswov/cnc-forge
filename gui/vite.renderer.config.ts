import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// vite.renderer.config.ts - for React renderer
export default defineConfig({
  plugins: [react()],
  root: 'renderer',
  build: {
    outDir: '../dist/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'renderer/src'),
      'cnc-forge-core': path.resolve(__dirname, '../../core/src'),
    },
  },
});