// Keep the homepage Areas We Cover section in sync with the current service area list.
// This runs from the hashed Vite app bundle, so updates are not blocked by an old cached helper script.
(function ensureExtraServiceAreas() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const extraAreas = [
    { name: 'Groomsport', href: '/bin-cleaning-groomsport' },
    { name: 'Greyabbey', href: '/bin-cleaning-greyabbey' },
  ];

  const BRAND_YELLOW = '#ffd400';

  function styleAreaLinks(linkContainer) {
    Array.from(linkContainer.querySelectorAll('a')).forEach((link) => {
      link.style.setProperty('color', BRAND_YELLOW, 'important');
      link.style.setProperty('background', 'rgba(255,212,0,.10)', 'important');
      link.style.setProperty('border', '1px solid rgba(255,212,0,.45)', 'important');
    });
  }

  function sync() {
    const section = document.getElementById('areas-we-cover');
    if (!section) return false;

    const linkContainer = section.querySelector('div[style*="flex-wrap"]') || section.querySelector('.areas');
    if (!linkContainer) return false;

    extraAreas.forEach(({ name, href }) => {
      const exists = Array.from(linkContainer.querySelectorAll('a')).some(
        (link) => (link.textContent || '').trim().toLowerCase() === name.toLowerCase()
      );
      if (exists) return;

      const link = document.createElement('a');
      link.href = href;
      link.textContent = name;
      link.style.cssText = 'display:inline-block;color:#ffd400;background:rgba(255,212,0,.10);border:1px solid rgba(255,212,0,.45);border-radius:999px;padding:9px 13px;text-decoration:none;font-weight:800;';
      linkContainer.appendChild(link);
    });

    styleAreaLinks(linkContainer);
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
