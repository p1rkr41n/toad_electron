import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^~/, replacement: '' },
      { find: 'toadviewer', replacement: path.resolve(__dirname, '../../tad-master/packages/toadviewer/src') },
      { find: 'reltab', replacement: path.resolve(__dirname, '../../tad-master/packages/reltab/src') },
      { find: 'aggtree', replacement: path.resolve(__dirname, '../../tad-master/packages/aggtree/src') },
      { find: 'host-bridge', replacement: path.resolve(__dirname, '../../tad-master/packages/host-bridge/src') },
    ],
  },
  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true,
        math: 'always',
      },
      scss: {
        api: 'modern-compiler',
      },
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 1420,
    strictPort: true,
  },
});
