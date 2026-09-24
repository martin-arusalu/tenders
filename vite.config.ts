import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { aiApi } from './server/aiApi.ts';

export default defineConfig(({ mode }) => ({
  // Relative asset paths, so the build works from any subpath (GitHub Pages serves it at /<repo>/).
  base: './',
  // '' prefix: load all vars for the server. Only VITE_* ones ever reach the browser.
  plugins: [react(), aiApi(loadEnv(mode, process.cwd(), ''))],
}));
