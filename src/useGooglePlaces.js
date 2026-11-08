// Shared Maps loader: one script and one promise for all booking dialogs.
// Reuse a script even if another component started loading it first.
let pendingGooglePlaces = null;

export function loadGooglePlaces(apiKey) {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Places requires a browser."));
  }
  if (window.google?.maps?.places) return Promise.resolve(window.google);
  if (!apiKey) return Promise.reject(new Error("Missing Google Maps browser key."));
  if (pendingGooglePlaces) return pendingGooglePlaces;

  pendingGooglePlaces = new Promise((resolve, reject) => {
    let settled = false;
    let script = document.querySelector("script[data-gmaps]");
    const existing = Boolean(script);
    if (!script) script = document.createElement("script");

    let timeout;
    const complete = () => {
      if (settled) return;
      if (!window.google?.maps?.places) {
        fail();
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      resolve(window.google);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(new Error("Unable to initialise Google Places."));
    };

    script.addEventListener("load", complete, { once: true });
    script.addEventListener("error", fail, { once: true });
    timeout = window.setTimeout(() => {
      if (window.google?.maps?.places) complete();
      else fail();
    }, 10000);

    if (!existing) {
      script.dataset.gmaps = "1";
      script.src = "https://maps.googleapis.com/maps/api/js?key=" +
        encodeURIComponent(apiKey) + "&libraries=places&v=weekly";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    } else if (window.google?.maps?.places) {
      complete();
    }
  }).catch((error) => {
    pendingGooglePlaces = null;
    throw error;
  });

  return pendingGooglePlaces;
}
