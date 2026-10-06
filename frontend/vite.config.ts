import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发时把接口与视频流代理到 NestJS(3000)，生产环境由后端直接托管打包产物
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
  },
});
