(function () {
  const intrinsicSizes = {
    '/logo.webp': [320, 320],
    '/logo2.webp': [320, 320],
    '/logo3.webp': [320, 320],
    '/logo4.webp': [320, 320],
    '/logo5.webp': [320, 320],
    '/bins/120L.webp': [512, 512],
    '/bins/240L.webp': [512, 512],
    '/bins/360L.webp': [512, 512],
    '/bins/660L.webp': [512, 512],
    '/bins/1100L.webp': [512, 512],
    '/odour.webp': [48, 48],
    '/bacteria.webp': [48, 48],
    '/pests.webp': [48, 48],
    '/family.webp': [48, 48],
  };

  function applyImageDimensions(root) {
    const images = root instanceof HTMLImageElement
      ? [root]
      : Array.from(root.querySelectorAll?.('img') || []);

    images.forEach((image) => {
      const source = image.getAttribute('src');
      const size = source ? intrinsicSizes[source] : null;
      if (!size) return;
      if (!image.hasAttribute('width')) image.setAttribute('width', String(size[0]));
      if (!image.hasAttribute('height')) image.setAttribute('height', String(size[1]));
      if (!image.hasAttribute('decoding')) image.setAttribute('decoding', 'async');
    });
  }

  applyImageDimensions(document);

  new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (node instanceof Element) applyImageDimensions(node);
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  function runNear(element, callback, rootMargin) {
    if (!element) return;

    if (!("IntersectionObserver" in window)) {
      callback();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        callback();
      },
      { rootMargin: rootMargin || "500px 0px" }
    );

    observer.observe(element);
  }

  runNear(document.getElementById("customer-reviews"), () => {
    window.dispatchEvent(new Event("nbg:load-reviews"));
  });

  runNear(document.getElementById("customer-portal"), () => {
    if (document.getElementById("squeegee-widget-script")) return;
    const script = document.createElement("script");
    script.id = "squeegee-widget-script";
    script.src = "https://widgets.sqg.ee/main.js";
    script.async = true;
    document.head.appendChild(script);
  }, "350px 0px");
})();
