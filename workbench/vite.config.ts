import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3108',
      '/afterglow-api': {
        target: 'http://127.0.0.1:3108',
        rewrite: (path) => path.replace(/^\/afterglow-api/, '/api'),
      },
    },
  },
});
