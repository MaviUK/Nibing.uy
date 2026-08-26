import { resolve } from 'node:path'
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
        .replace(/({ id: "comm_gt660_4w", label: "Commercial >660L 4 Weekly", price: )12\.5( })/, '$115$2')
        .replace(/({ id: "comm_gt660_oneoff", label: "Commercial >660L One-Off", price: )35( })/, '$145$2')
        .replace(
          '{ src: "/bins/120L.webp", alt: "120 litre wheelie bin", size: "120L", h: "h-32" }',
          '{ src: "/bins/120L.webp", alt: "120 litre wheelie bin", size: "120L", h: "h-32", width: 384, height: 286 }'
        )
        .replace(
          '{ src: "/bins/240L.webp", alt: "240 litre wheelie bin", size: "240L", h: "h-36" }',
          '{ src: "/bins/240L.webp", alt: "240 litre wheelie bin", size: "240L", h: "h-36", width: 384, height: 307 }'
        )
        .replace(
          '{ src: "/bins/360L.webp", alt: "360 litre commercial bin", size: "360L", h: "h-40" }',
          '{ src: "/bins/360L.webp", alt: "360 litre commercial bin", size: "360L", h: "h-40", width: 384, height: 276 }'
        )
        .replace(
          '{ src: "/bins/660L.webp", alt: "660 litre commercial waste bin", size: "660L", h: "h-44" }',
          '{ src: "/bins/660L.webp", alt: "660 litre commercial waste bin", size: "660L", h: "h-44", width: 384, height: 345 }'
        )
        .replace(
          '{ src: "/bins/1100L.webp", alt: "1100 litre commercial waste container", size: "1100L", h: "h-48" }',
          '{ src: "/bins/1100L.webp", alt: "1100 litre commercial waste container", size: "1100L", h: "h-48", width: 384, height: 387 }'
        )
        .replace(
          '<img src={it.src} alt={it.alt} loading="lazy" decoding="async" className={`${it.h} mb-2`} />',
          '<img src={it.src} alt={it.alt} width={it.width} height={it.height} loading="lazy" decoding="async" style={{ width: "auto", maxWidth: "100%", objectFit: "contain" }} className={`${it.h} mb-2`} />'
        )

      return updatedCode === code ? null : { code: updatedCode, map: null }
    }
  }
}

function niBinGuyLayoutStability() {
  const stabilityHead = `
  <style id="nbg-layout-stability">
    body:not(.nbg-app-ready) #root ~ section,
    body:not(.nbg-app-ready) #root ~ footer {
      visibility: hidden;
    }

    @media (min-width: 768px) {
      #customer-reviews {
        min-height: 760px;
        box-sizing: border-box;
      }

      #google-reviews-list {
        min-height: 430px;
      }
    }
  </style>
  <script>
    (function () {
      function revealStaticSections() {
        if (!document.body || !document.getElementById('main-content')) return false;
        document.body.classList.add('nbg-app-ready');
        return true;
      }

      function watchForApp() {
        if (revealStaticSections()) return;
        var root = document.getElementById('root');
        if (!root) return;
        var observer = new MutationObserver(function () {
          if (revealStaticSections()) observer.disconnect();
        });
        observer.observe(root, { childList: true, subtree: true });
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', watchForApp, { once: true });
      } else {
        watchForApp();
      }
    })();
  </script>`

  return {
    name: 'ni-bin-guy-layout-stability',
    transformIndexHtml(html) {
      return html.replace('</head>', `${stabilityHead}\n</head>`)
    }
  }
}

function niBinGuyLcpLogoDiscovery() {
  const randomLogoScript = /\n  <script>\s*\(function \(\) \{\s*const logos = \[[\s\S]*?new MutationObserver\(applySelectedLogo\)\.observe\(document\.documentElement, \{ childList: true, subtree: true \}\);\s*\}\)\(\);\s*<\/script>/

  return {
    name: 'ni-bin-guy-lcp-logo-discovery',
    transformIndexHtml(html) {
      return html.replace(randomLogoScript, '')
    }
  }
}

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        streetBooking: resolve(__dirname, 'street-booking.html')
      }
    }
  },
  plugins: [
    niBinGuyPriceOverrides(),
    niBinGuyLayoutStability(),
    niBinGuyLcpLogoDiscovery(),
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
