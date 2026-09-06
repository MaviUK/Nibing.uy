// Keep the homepage Areas We Cover section in sync with the canonical service area pages.
// This runs from the hashed Vite app bundle, so updates are not blocked by an old cached helper script.
(function ensureServiceAreaLinks() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const areas = [
    { name: 'Bangor', href: '/bin-cleaning-bangor/' },
    { name: 'Groomsport', href: '/bin-cleaning-groomsport' },
    { name: 'Donaghadee', href: '/bin-cleaning-donaghadee' },
    { name: 'Newtownards', href: '/bin-cleaning-newtownards' },
    { name: 'Greyabbey', href: '/bin-cleaning-greyabbey' },
    { name: 'Comber', href: '/bin-cleaning-comber' },
    { name: 'Millisle', href: '/bin-cleaning-millisle' },
    { name: 'Ballywalter', href: '/bin-cleaning-ballywalter' },
    { name: 'Portaferry', href: '/bin-cleaning-portaferry' },
    { name: 'Portavogie', href: '/bin-cleaning-portavogie' },
    { name: 'Cloughey', href: '/bin-cleaning-cloughey' },
    { name: 'Ballyhalbert', href: '/bin-cleaning-ballyhalbert' },
  ];

  const linkStyle = 'display:inline-block;color:#ffd400;background:rgba(255,212,0,.12);border:1px solid rgba(255,212,0,.42);border-radius:999px;padding:9px 13px;text-decoration:none;font-weight:800;';

  function sync() {
    const section = document.getElementById('areas-we-cover');
    if (!section) return false;

    const linkContainer = section.querySelector('div[style*="flex-wrap"]') || section.querySelector('.areas');
    if (!linkContainer) return false;

    areas.forEach(({ name, href }) => {
      let link = Array.from(linkContainer.querySelectorAll('a')).find(
        (candidate) => (candidate.textContent || '').trim().toLowerCase() === name.toLowerCase()
      );

      if (!link) {
        link = document.createElement('a');
        link.textContent = name;
        linkContainer.appendChild(link);
      }

      // Keep every homepage town link pointed directly at its canonical URL.
      link.href = href;
      link.title = `Wheelie bin cleaning in ${name}`;
      link.setAttribute('aria-label', `Wheelie bin cleaning in ${name}`);
      link.style.cssText = linkStyle;
    });

    return true;
  }

  if (!sync()) {
    const observer = new MutationObserver(() => {
      if (sync()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 15000);
  }
})();
