"use strict";
// Optional request-origin metadata is not sent by every Android browser.
// Owner authentication and a session-bound HMAC CSRF token are separately
// mandatory on the caller before any Squeegee write.
const EXPECTED_ORIGIN = "https://deploy-preview-77--nibinguy.netlify.app";

function trustedOwnerPostMetadata(headers) {
  if (!headers || typeof headers.get !== "function") return false;
  const origin = headers.get("origin");
  const referrer = headers.get("referer");
  const fetchSite = headers.get("sec-fetch-site");
  if (origin !== null && origin !== EXPECTED_ORIGIN) return false;
  if (referrer !== null) {
    try {
      if (new URL(referrer).origin !== EXPECTED_ORIGIN) return false;
    } catch { return false; }
  }
  if (fetchSite !== null && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }
  return true;
}
module.exports = { trustedOwnerPostMetadata, EXPECTED_ORIGIN };
