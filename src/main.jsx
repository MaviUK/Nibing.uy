import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './bookingScheduleBridge.js';
import './serviceAreaGuard.js';

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