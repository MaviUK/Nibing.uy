import type { Config, Context } from "@netlify/edge-functions";

const SUCCESS_UI = String.raw`<script>
(function () {
  if (window.__nbgSuccessUiInstalled) return;
  window.__nbgSuccessUiInstalled = true;

  var lastBookingAutomatic = false;
  var originalFetch = window.fetch.bind(window);

  window.fetch = async function () {
    var response = await originalFetch.apply(window, arguments);
    try {
      var input = arguments[0];
      var url = typeof input === "string" ? input : (input && input.url) || "";
      if (url.indexOf("/.netlify/functions/sendBookingEmail") !== -1 && response.ok) {
        var clone = response.clone();
        var data = await clone.json().catch(function () { return null; });
        lastBookingAutomatic = Boolean(data && data.automatic);
      }
    } catch (_) {}
    return response;
  };

  function showSuccess(automatic) {
    var old = document.getElementById("nbg-booking-success-overlay");
    if (old) old.remove();

    var overlay = document.createElement("div");
    overlay.id = "nbg-booking-success-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.76);display:flex;align-items:center;justify-content:center;padding:22px;font-family:Arial,sans-serif;";

    var card = document.createElement("div");
    card.style.cssText = "width:min(100%,430px);background:#fff;border-radius:22px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.45);text-align:center;";

    var heading = automatic ? "Booking Confirmed" : "Booking Received";
    var message = automatic
      ? "Your clean date is confirmed and your booking is secured. We've sent all the details to your email."
      : "We've received your booking. We'll confirm your clean date with you shortly.";

    card.innerHTML =
      '<div style="background:#08140e;padding:28px 24px 22px">' +
        '<div style="width:72px;height:72px;margin:0 auto 16px;border-radius:50%;background:#19b864;display:flex;align-items:center;justify-content:center;color:#fff;font-size:42px;font-weight:900;line-height:1">✓</div>' +
        '<div style="color:#fff;font-size:28px;font-weight:900;line-height:1.1">' + heading + '</div>' +
        '<div style="color:#ffd400;font-size:15px;font-weight:800;margin-top:8px">YOUR BIN\'S DAYS ARE NUMBERED.</div>' +
      '</div>' +
      '<div style="padding:25px 24px 24px">' +
        '<div style="font-size:16px;line-height:1.55;color:#333">' + message + '</div>' +
        '<div style="margin-top:18px;padding:13px 14px;border-radius:12px;background:#f1fbf5;color:#166534;font-size:14px;font-weight:700">Check your inbox for your NI Bin Guy confirmation.</div>' +
        '<button id="nbg-booking-success-close" type="button" style="margin-top:20px;width:100%;border:0;border-radius:12px;background:#0b6b44;color:#fff;padding:15px 18px;font-size:17px;font-weight:800;cursor:pointer">Done</button>' +
      '</div>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";

    function close() {
      overlay.remove();
      document.body.style.overflow = "";
    }
    card.querySelector("#nbg-booking-success-close").addEventListener("click", close);
    overlay.addEventListener("click", function (event) { if (event.target === overlay) close(); });
  }

  var nativeAlert = window.alert.bind(window);
  window.alert = function (message) {
    var text = String(message || "");
    if (text.indexOf("Booking received!") !== -1) {
      showSuccess(lastBookingAutomatic);
      lastBookingAutomatic = false;
      return;
    }
    nativeAlert(message);
  };
})();
</script>`;

export default async function handler(req: Request, context: Context) {
  const response = await context.next();
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  const html = await response.text();
  const injected = html.includes("</body>")
    ? html.replace("</body>", `${SUCCESS_UI}</body>`)
    : `${html}${SUCCESS_UI}`;

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(injected, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export const config: Config = {
  path: "/",
};
