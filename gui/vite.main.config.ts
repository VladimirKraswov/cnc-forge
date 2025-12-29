import { defineConfig } from 'vite';
import path from 'path';

// vite.main.config.ts - for main and preload
export default defineConfig({
  build: {
    outDir: 'dist',
    lib: {
      entry: ['main.ts', 'preload.ts'],
      formats: ['cjs'],
    },
    rollupOptions: {
      external: ['electron', 'events', 'path'],
    },
  },
  resolve: {
    alias: {
      'cnc-forge-core': path.resolve(__dirname, '../core/src'),
    },
  },
});