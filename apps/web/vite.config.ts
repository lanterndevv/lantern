import { defineConfig } from 'vite';

export default defineConfig({
  server: { proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } } },
  build: { rollupOptions: { input: ['index.html', 'render-demo.html', 'dice-demo.html'] } },
});
