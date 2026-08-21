import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

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

// Load the visible booking scheduler from the Vite app entry point rather than
// relying on the separately cached site-tracking.js file.
if (!window.location.pathname.startsWith('/street-booking') && !document.getElementById('booking-schedule-ui-script')) {
  const scheduleScript = document.createElement('script');
  scheduleScript.id = 'booking-schedule-ui-script';
  scheduleScript.src = '/booking-schedule-ui.js?v=20260821-2';
  scheduleScript.defer = true;
  document.head.appendChild(scheduleScript);
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);