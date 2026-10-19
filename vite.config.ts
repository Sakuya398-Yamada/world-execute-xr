import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

// `vite --mode https` のときだけ自己署名証明書で HTTPS 起動する(LAN 内のスマホから直接開く用)
export default defineConfig(({ mode }) => ({
  plugins: mode === 'https' ? [basicSsl()] : [],
}));
