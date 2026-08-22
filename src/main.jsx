import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './bookingScheduleBridge.js';
import './bookingCommentsBridge.js';
import './serviceAreaGuard.js';
import './serviceAreaLinks.js';

// Preload reCAPTCHA v3 as soon as the app starts so it is ready by the time
// a customer submits the booking form. LandingPage also has its own loader,
// so this is intentionally defensive rather than a replacement.
const recaptchaSiteKey = import.meta.env?.VITE_RECAPTCHA_SITE_KEY;
if (recaptchaSiteKey && !document.getElementById('recaptcha-script')) {
  const script = document.createElement('script');
  script.id = 'recaptcha-script';
  script.src = `https://www.google.com/recaptcha/api.js?render=${recaptchaSiteKey}`;
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// Town landing pages link back with ?book=1. Handle that here in the
// bundled app so it cannot be missed because of a cached public script.
if (new URLSearchParams(window.location.search).get('book') === '1') {
  let attempts = 0;
  const openBookingWhenReady = window.setInterval(() => {
    attempts += 1;

    const main = document.getElementById('main-content');
    const bookingButton = main
      ? Array.from(main.querySelectorAll('button')).find(
          (button) => (button.textContent || '').trim() === 'Book a Clean'
        )
      : null;

    if (bookingButton) {
      window.clearInterval(openBookingWhenReady);
      bookingButton.click();

      const url = new URL(window.location.href);
      url.searchParams.delete('book');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      return;
    }

    if (attempts >= 150) {
      window.clearInterval(openBookingWhenReady);
    }
  }, 100);
}
