import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

function niBinGuyPriceOverrides() {
  return {
    name: 'ni-bin-guy-price-overrides',
    enforce: 'pre',
    transform(code, id) {
      const normalisedId = id.replace(/\\/g, '/')
      if (!normalisedId.endsWith('/src/LandingPage.jsx')) return null

      const updatedCode = code
        .replace(/({ id: "domestic_oneoff", label: "One-off", price: )12\.5( })/, '$115$2')
        .replace(/({ id: "comm_lt360_oneoff", label: "Commercial <360L One-Off", price: )12\.5( })/, '$115$2')
        .replace(/({ id: "comm_gt660_oneoff", label: "Commercial >660L One-Off", price: )30( })/, '$135$2')

      return updatedCode === code ? null : { code: updatedCode, map: null }
    }
  }
}

export default defineConfig({
  plugins: [
    niBinGuyPriceOverrides(),
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'public/_redirects',
          dest: '.'
        }
      ]
    })
  ],
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    sourcemap: false
  }
})
