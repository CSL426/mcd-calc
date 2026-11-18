import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相對路徑：放在 nginx 根目錄或子路徑底下都能跑
  base: './',
  server: { port: 5173, strictPort: true },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
