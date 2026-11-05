import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  base: './',
  clearScreen: false,
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^~\//, replacement: path.resolve(__dirname, 'src/') + '/' },
      { find: /^~/, replacement: '' },
      { find: 'path', replacement: 'path-browserify' },
      { find: 'toadviewer', replacement: path.resolve(__dirname, 'src') },
      { find: 'reltab', replacement: path.resolve(__dirname, '../../tad-master/packages/reltab/src/reltab.ts') },
      { find: 'aggtree', replacement: path.resolve(__dirname, '../../tad-master/packages/aggtree/src/aggtree.ts') },
      { find: 'host-bridge', replacement: path.resolve(__dirname, '../../tad-master/packages/host-bridge/src/index.ts') },
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
        silenceDeprecations: ['import', 'global-builtin', 'color-functions'],
      },
    },
  },
  build: {
    target: ['es2021', 'chrome105', 'safari13'],
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          blueprint: ['@blueprintjs/core', '@blueprintjs/icons', '@blueprintjs/popover2'],
          arrow: ['@apache-arrow/es2015-cjs'],
        },
      },
    },
  },
  optimizeDeps: {
    include: [
      '@apache-arrow/es2015-cjs',
      'react',
      'react-dom',
      '@blueprintjs/core',
      'slickgrid-es6',
      'oneref',
      'he',
      'lodash',
      'immutable',
      'victory',
      'url-regex',
      'path-browserify',
    ],
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
});
