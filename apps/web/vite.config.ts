import { defineConfig } from 'vite';

export default defineConfig({
  server: { proxy: { '/api': 'http://localhost:8787', '/assets': 'http://localhost:8787', '/ws': { target: 'ws://localhost:8787', ws: true } } },
  build: { rollupOptions: { input: ['index.html', 'render-demo.html', 'dice-demo.html'] } },
});
