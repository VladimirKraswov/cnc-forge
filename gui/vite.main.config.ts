import { defineConfig } from 'vite';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    outDir: 'dist',
    lib: {
      entry: ['main.ts', 'preload.ts'],
      formats: ['cjs'],
    },
    rollupOptions: {
      external: ['electron'],
    },
  },
  resolve: {
    alias: {
      'cnc-forge-core': path.resolve(__dirname, '../core/src'),
    },
  },
});
