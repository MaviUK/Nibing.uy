(function () {
  if (window.location.pathname.indexOf("/street-booking") === 0) {
    var oldIcons = document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"], link[rel="manifest"]');
    oldIcons.forEach(function (node) { node.remove(); });

    var icon = document.createElement("link");
    icon.rel = "icon";
    icon.type = "image/svg+xml";
    icon.href = "/street-signup-icon.svg?v=2";
    document.head.appendChild(icon);

    var apple = document.createElement("link");
    apple.rel = "apple-touch-icon";
    apple.href = "/street-signup-icon.svg?v=2";
    document.head.appendChild(apple);

    var manifest = document.createElement("link");
    manifest.rel = "manifest";
    manifest.href = "/street-signup.webmanifest?v=2";
    document.head.appendChild(manifest);

    var theme = document.querySelector('meta[name="theme-color"]') || document.createElement("meta");
    theme.name = "theme-color";
    theme.content = "#050505";
    if (!theme.parentNode) document.head.appendChild(theme);
  }

  // Keep the normal booking endpoint protected by reCAPTCHA, while routing
  // genuine 10-second challenge winner forms to their dedicated endpoint.
  var originalFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      var url = typeof input === "string" ? input : input && input.url;
      if (url && url.indexOf("/.netlify/functions/sendBookingEmail") !== -1 && init && typeof init.body === "string") {
        var body = JSON.parse(init.body);
        if (body && body.source === "ten-second-challenge") {
          input = "/.netlify/functions/sendChallengeWinnerEmail";
        }
      }
    } catch (error) {}

    return originalFetch.call(window, input, init);
  };

  function safeLabel(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 80);
  }

  function eventNameFor(element) {
    if (!element) return null;
    if (element.dataset && element.dataset.track) return element.dataset.track;

    var href = element.getAttribute && element.getAttribute("href");
    var text = safeLabel(element.textContent);

    if (href) {
      if (href.indexOf("tel:") === 0) return "phone_click";
      if (href.indexOf("mailto:") === 0) return "email_click";
      if (href.indexOf("wa.me") !== -1 || href.indexOf("whatsapp") !== -1) return "whatsapp_click";
      if (href.indexOf("facebook.com") !== -1) return "facebook_click";
      if (href.indexOf("share.google") !== -1 || href.indexOf("google") !== -1) return "google_click";
      if (href.indexOf("#customer-portal") !== -1 || href.indexOf("sqgee.com") !== -1) return "customer_portal_click";
    }

    if (/book a clean/i.test(text) || /book a bin clean/i.test(text)) return "book_click";
    if (/customer portal/i.test(text)) return "customer_portal_click";

    return null;
  }

  function sendEvent(name, element) {
    if (!name) return;

    var href = element && element.getAttribute ? element.getAttribute("href") : "";
    var payload = {
      event: name,
      label: safeLabel(element && element.textContent),
      href: href || "",
      path: window.location.pathname,
      ts: new Date().toISOString()
    };

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(payload);

    try {
      window.dispatchEvent(new CustomEvent("nbg:track", { detail: payload }));
    } catch (error) {}
  }

  document.addEventListener("click", function (event) {
    var target = event.target.closest("a, button");
    if (!target) return;
    sendEvent(eventNameFor(target), target);
  }, true);
})();
