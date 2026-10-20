import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// unit: three.js に依存しない計算などのテスト(Node で動かす)
// browser: 全シーンを実際に WebGL で描いてみる確認(headless Chromium。GPU が無い環境でも動くよう SwiftShader で描く)
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          testTimeout: 120_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: {
                // Playwright が取得したものと別の Chromium を使うとき(クラウド環境など)に指定する
                executablePath: process.env.CHROMIUM_PATH,
                args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
              },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
