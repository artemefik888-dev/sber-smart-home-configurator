import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'sber-smart-home-configurator';
const requestedBase = process.env.PAGES_BASE_PATH
  ?? (process.env.GITHUB_ACTIONS === 'true' ? `/${repositoryName}/` : '/');
const base = requestedBase.endsWith('/') ? requestedBase : `${requestedBase}/`;

export default defineConfig({
  base,
  plugins: [react()],
  server: isCodexSeatbeltSandbox
    ? { watch: { useFsEvents: false, usePolling: true } }
    : undefined,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
