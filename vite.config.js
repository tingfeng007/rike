import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { offlineShellPlugin } from './scripts/offline-shell-plugin.mjs'
import { buildInfoPlugin } from './scripts/build-info-plugin.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), offlineShellPlugin(), buildInfoPlugin()],
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})
