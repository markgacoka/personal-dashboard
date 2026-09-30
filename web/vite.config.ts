import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const api = process.env.DEV_API || 'http://localhost:3000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': { target: api, changeOrigin: false }, '/login': api, '/classic': api } },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: id => {
          if (id.includes('maplibre-gl')) return 'maplibre'
          if (id.includes('recharts') || id.includes('d3-')) return 'charts'
        },
      },
    },
  },
})
