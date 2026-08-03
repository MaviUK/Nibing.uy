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

function niBinGuyInitialLoader() {
  const loaderHead = `
  <link rel="preload" as="image" href="/logo.png">
  <script>
    (function () {
      var path = window.location.pathname.replace(/\\/+$/, '') || '/';
      if (path === '/') document.documentElement.setAttribute('data-nbg-loading', 'true');
    })();
  </script>
  <style>
    html[data-nbg-loading="true"],
    html[data-nbg-loading="true"] body {
      overflow: hidden !important;
      background: #000 !important;
    }

    #nbg-initial-loader {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 18px;
      padding: 24px;
      box-sizing: border-box;
      background: #000;
      color: #fff;
      font-family: Arial, Helvetica, sans-serif;
      opacity: 1;
      visibility: visible;
      transition: opacity 350ms ease, visibility 350ms ease;
    }

    html:not([data-nbg-loading="true"]) #nbg-initial-loader {
      display: none;
    }

    #nbg-initial-loader.is-leaving {
      opacity: 0;
      visibility: hidden;
    }

    #nbg-initial-loader img {
      width: min(180px, 48vw);
      height: auto;
      border-radius: 18px;
      box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
    }

    #nbg-initial-loader-spinner {
      width: 34px;
      height: 34px;
      border: 3px solid rgba(255, 255, 255, 0.22);
      border-top-color: #4ade80;
      border-radius: 50%;
      animation: nbg-loader-spin 800ms linear infinite;
    }

    #nbg-initial-loader p {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    @keyframes nbg-loader-spin {
      to { transform: rotate(360deg); }
    }

    @media (prefers-reduced-motion: reduce) {
      #nbg-initial-loader-spinner { animation: none; }
      #nbg-initial-loader { transition: none; }
    }
  </style>`

  const loaderBody = `
  <div id="nbg-initial-loader" role="status" aria-live="polite" aria-label="Loading Ni Bin Guy website">
    <img src="/logo.png" alt="" width="180" height="180" fetchpriority="high">
    <div id="nbg-initial-loader-spinner" aria-hidden="true"></div>
    <p>Loading Ni Bin Guy&hellip;</p>
  </div>`

  const loaderScript = `
  <script>
    (function () {
      var root = document.documentElement;
      var loader = document.getElementById('nbg-initial-loader');
      if (!loader || root.getAttribute('data-nbg-loading') !== 'true') return;

      var startedAt = Date.now();
      var minimumVisibleUntil = startedAt + 550;
      var forceFinishAt = startedAt + 8000;
      var finished = false;

      function appReady() {
        return Boolean(document.getElementById('main-content'));
      }

      function reviewsReady() {
        var reviews = document.getElementById('google-reviews-list');
        if (!reviews) return false;
        var text = (reviews.textContent || '').trim().toLowerCase();
        return Boolean(text) && text.indexOf('loading google reviews') === -1;
      }

      function readyToReveal() {
        return document.readyState === 'complete' &&
          appReady() &&
          reviewsReady() &&
          Date.now() >= minimumVisibleUntil;
      }

      function finish(force) {
        if (finished || (!force && !readyToReveal())) return;
        finished = true;
        loader.classList.add('is-leaving');

        window.setTimeout(function () {
          root.removeAttribute('data-nbg-loading');
          loader.remove();
        }, 350);
      }

      function check() {
        if (readyToReveal()) {
          finish(false);
          return;
        }

        if (Date.now() >= forceFinishAt) {
          finish(true);
          return;
        }

        window.setTimeout(check, 100);
      }

      window.addEventListener('load', function () {
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(check);
        });
      }, { once: true });

      check();
    })();
  </script>`

  return {
    name: 'ni-bin-guy-initial-loader',
    transformIndexHtml(html) {
      return html
        .replace('<head>', `<head>${loaderHead}`)
        .replace('<body>', `<body>${loaderBody}`)
        .replace('</body>', `${loaderScript}</body>`)
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
          dest: '.' // copy to the root of dist/
        }
      ]
    })
  ]
})
