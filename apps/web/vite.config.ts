import { defineConfig } from 'vite';

export default defineConfig({
  server: { proxy: { '/api': 'http://localhost:8787', '/assets': 'http://localhost:8787', '/ws': { target: 'ws://localhost:8787', ws: true } } },
  // Build en /static/: /assets/ es de los archivos que suben los DM (servidor).
  build: { assetsDir: 'static', rollupOptions: { input: ['index.html', 'render-demo.html', 'dice-demo.html'] } },
});
