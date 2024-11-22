import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env': process.env
  },
  server: {
    port: process.env.DEMO_FRONTEND_PORT || 5174,
    host: true,
    proxy: {
      '/api': {
        target: 'http://rpc-01.test.arch.network',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})