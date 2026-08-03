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
        .replace(
          '{ src: "/bins/120L.webp", alt: "120 litre wheelie bin", size: "120L", h: "h-32" }',
          '{ src: "/bins/120L.webp", alt: "120 litre wheelie bin", size: "120L", h: "h-32", width: 286, height: 384 }'
        )
        .replace(
          '{ src: "/bins/240L.webp", alt: "240 litre wheelie bin", size: "240L", h: "h-36" }',
          '{ src: "/bins/240L.webp", alt: "240 litre wheelie bin", size: "240L", h: "h-36", width: 307, height: 384 }'
        )
        .replace(
          '{ src: "/bins/360L.webp", alt: "360 litre commercial bin", size: "360L", h: "h-40" }',
          '{ src: "/bins/360L.webp", alt: "360 litre commercial bin", size: "360L", h: "h-40", width: 276, height: 384 }'
        )
        .replace(
          '{ src: "/bins/660L.webp", alt: "660 litre commercial waste bin", size: "660L", h: "h-44" }',
          '{ src: "/bins/660L.webp", alt: "660 litre commercial waste bin", size: "660L", h: "h-44", width: 345, height: 384 }'
        )
        .replace(
          '{ src: "/bins/1100L.webp", alt: "1100 litre commercial waste container", size: "1100L", h: "h-48" }',
          '{ src: "/bins/1100L.webp", alt: "1100 litre commercial waste container", size: "1100L", h: "h-48", width: 387, height: 384 }'
        )
        .replace(
          '<img src={it.src} alt={it.alt} loading="lazy" decoding="async" className={`${it.h} mb-2`} />',
          '<img src={it.src} alt={it.alt} width={it.width} height={it.height} loading="lazy" decoding="async" className={`${it.h} mb-2`} />'
        )

      return updatedCode === code ? null : { code: updatedCode, map: null }
    }
  }
}

function niBinGuyReviewLayoutStability() {
  const reviewSpaceCss = `
  <style id="nbg-review-layout-stability">
    @media (min-width: 768px) {
      #customer-reviews {
        min-height: 760px;
        box-sizing: border-box;
      }

      #google-reviews-list {
        min-height: 430px;
      }
    }
  </style>`

  return {
    name: 'ni-bin-guy-review-layout-stability',
    transformIndexHtml(html) {
      return html.replace('</head>', `${reviewSpaceCss}\n</head>`)
    }
  }
}

export default defineConfig({
  plugins: [
    niBinGuyPriceOverrides(),
    niBinGuyReviewLayoutStability(),
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'public/_redirects',
          dest: '.' // copy to the root of dist/
        }
      ]
    })
  ]
})
