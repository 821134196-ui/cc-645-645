import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 媒体流也走代理，<video> 可直接使用 /api 相对地址
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
