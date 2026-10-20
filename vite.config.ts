import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, type Plugin } from 'vite';

/**
 * 音源は公開しない(著作物)。手元の public/audio/ はビルドのときに dist/ へコピーされてしまうので、ビルドの最後に消す。
 * 公開したものでは、見る人が自分の音源ファイルを選ぶ。
 */
function excludeAudio(): Plugin {
  let outDir = '';
  return {
    name: 'exclude-audio',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      rmSync(resolve(outDir, 'audio'), { recursive: true, force: true });
    },
  };
}

// `vite --mode https` のときだけ自己署名証明書で HTTPS 起動する(LAN 内のスマホから直接開く用)
export default defineConfig(({ mode }) => ({
  plugins: [excludeAudio(), ...(mode === 'https' ? [basicSsl()] : [])],
}));
