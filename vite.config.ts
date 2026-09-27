/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// liblouis.mjs 是由 emscripten 生成的自研封装（SINGLE_FILE，内嵌 wasm），
// 不做 TS 检查，由 src/wasm/liblouis.d.ts 提供类型声明。
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ['./src/wasm/liblouis.mjs'] },
  build: {
    target: 'es2020',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
