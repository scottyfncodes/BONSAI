import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Keep the 3D engine in its own long-lived cached chunk.
        manualChunks: (id) => (id.includes('node_modules/three') ? 'three' : id.includes('node_modules') ? 'vendor' : undefined),
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
