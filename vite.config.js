import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { offlineShellPlugin } from './scripts/offline-shell-plugin.mjs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), offlineShellPlugin()],
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
})
