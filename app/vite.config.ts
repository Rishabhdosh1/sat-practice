import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Bind on all interfaces so the app is reachable from a phone on the same
    // Wi-Fi, not just from this machine.
    host: true,
    port: 5173,
  },
})
