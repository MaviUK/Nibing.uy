function findBookingRoot() {
  const heading = Array.from(document.querySelectorAll('h2')).find((node) => /book a bin clean/i.test(node.textContent || ''));
  return heading?.closest('.p-6') || heading?.parentElement || null;
}

function ensureCommentsField(root) {
  if (!root || root.querySelector('[data-booking-comments]')) return;

  const email = root.querySelector('input[placeholder="Email Address"]');
  if (!email) return;

  const wrap = document.createElement('div');
  wrap.dataset.bookingComments = 'true';
  wrap.className = 'mt-3';
  wrap.innerHTML = `
    <label style="display:block;font-weight:700;margin-bottom:6px;color:#374151;">Comments / Bin Day Issues <span style="font-weight:400;color:#6b7280;">(optional)</span></label>
    <textarea
      data-booking-comments-input
      rows="3"
      placeholder="Tell us if the council bin day shown looks wrong, or add any other notes."
      style="width:100%;border:1px solid #6b7280;border-radius:0.5rem;padding:0.75rem 1rem;resize:vertical;background:#fff;color:#111827;"
    ></textarea>
  `;

  email.insertAdjacentElement('afterend', wrap);
}

function getComments() {
  return String(document.querySelector('[data-booking-comments-input]')?.value || '').trim();
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  const isBookingEmail = /sendBookingEmail/i.test(url);
  let nextInit = init;

  if (isBookingEmail && typeof init?.body === 'string') {
    try {
      const parsedBody = JSON.parse(init.body);
      const comments = getComments();
      if (comments) parsedBody.comments = comments;
      nextInit = { ...init, body: JSON.stringify(parsedBody) };
    } catch (_) {}
  }

  // Comments are now carried in the main booking payload. Do not send the
  // old separate admin comment email after the booking succeeds.
  return originalFetch(input, nextInit);
};

const originalOpen = window.open.bind(window);
window.open = (url, target, features) => {
  try {
    const comments = getComments();
    const value = String(url || '');
    if (comments && /wa\.me\//i.test(value) && /text=/i.test(value)) {
      const parsed = new URL(value);
      const message = parsed.searchParams.get('text') || '';
      parsed.searchParams.set('text', `${message}\n\nComments / Bin Day Issues: ${comments}`);
      url = parsed.toString();
    }
  } catch (_) {}
  return originalOpen(url, target, features);
};

const observer = new MutationObserver(() => {
  const root = findBookingRoot();
  if (root) ensureCommentsField(root);
});
observer.observe(document.documentElement, { childList: true, subtree: true });

window.setTimeout(() => {
  const root = findBookingRoot();
  if (root) ensureCommentsField(root);
}, 0);
