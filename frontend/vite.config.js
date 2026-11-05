import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In dev, forward API calls to `wrangler dev` (default port 8787).
const API_ROUTES = ['/all', '/search', '/ingest', '/sync', '/feedback']
const target = process.env.WORKER_URL || 'http://localhost:8787'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(API_ROUTES.map((route) => [route, { target, changeOrigin: true }])),
  },
})
