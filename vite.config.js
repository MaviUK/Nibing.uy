import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

function niBinGuySourceTransforms() {
  return {
    name: 'ni-bin-guy-source-transforms',
    enforce: 'pre',
    transform(code, id) {
      const normalisedId = id.replace(/\\/g, '/')
      if (!normalisedId.endsWith('/src/LandingPage.jsx')) return null

      const updatedCode = code
        .replace(/({ id: "domestic_oneoff", label: "One-off", price: )12\.5( })/, '$115$2')
        .replace(/({ id: "comm_lt360_oneoff", label: "Commercial <360L One-Off", price: )12\.5( })/, '$115$2')
        .replace(/({ id: "comm_gt660_oneoff", label: "Commercial >660L One-Off", price: )30( })/, '$135$2')
        // Snow is permanently disabled, so remove its sizeable canvas implementation
        // from the production bundle instead of shipping code visitors cannot use.
        .replace(
          /\/\*\s*─+\s*Snow \(Canvas\) \+ Toggle[\s\S]*?function SnowCanvas\([\s\S]*?\n}\n\n(?=\/\*\s*─+\s*Generic UI)/,
          ''
        )
        .replace(
          /\n  \/\/ Snow toggle \(persisted\)[\s\S]*?\n  const toggleSnow = \(\) => \{[\s\S]*?\n  \};\n/,
          '\n'
        )
        .replace(
          /\n      \{\/\* Snow overlay \*\/\}\n      <SnowCanvas enabled=\{snowEnabled\} \/>\n/,
          '\n'
        )
        // Reserve intrinsic space for the below-the-fold bin images.
        .replace(
          '<img src={it.src} alt={it.alt} loading="lazy" decoding="async" className={`${it.h} mb-2`} />',
          '<img src={it.src} alt={it.alt} width="512" height="512" loading="lazy" decoding="async" className={`${it.h} mb-2`} />'
        )

      return updatedCode === code ? null : { code: updatedCode, map: null }
    }
  }
}

export default defineConfig({
  plugins: [
    niBinGuySourceTransforms(),
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
  esbuild: {
    drop: ['console', 'debugger'],
    legalComments: 'none'
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    sourcemap: false,
    modulePreload: { polyfill: false },
    minify: 'esbuild'
  }
})
