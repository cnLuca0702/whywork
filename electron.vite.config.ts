import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    cacheDir: '.cache/vite-main',
    // pdfjs-dist 是 ESM(.mjs)，不能外置给 CJS require，需打进主进程包
    plugins: [externalizeDepsPlugin({ exclude: ['pdfjs-dist'] })]
  },
  preload: {
    cacheDir: '.cache/vite-preload',
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    cacheDir: '.cache/vite-renderer',
    plugins: [react(), tailwindcss()]
  }
})
