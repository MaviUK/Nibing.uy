/*
 * Preview 1 only: a short-lived, one-use, rate-limited browser work challenge
 * for testing bookings when the production reCAPTCHA key rejects the Netlify
 * deploy-preview domain. This is NOT enabled on the live/main hostname.
 *
 * It is intentionally more restrictive than an unchecked CAPTCHA bypass:
 * signed 3-minute tickets, 12-bit SHA256 work, browser origin checks,
 * per-client issue/verification limits and single-use redemption.
 * Production continues to use Google reCAPTCHA v3.
 */
const crypto = require("node:crypto");
const { getStore } = require("@netlify/blobs");
const PREVIEW_ORIGIN = "https://deploy-preview-77--nibinguy.netlify.app";
const PREVIEW_HOST = "deploy-preview-77--nibinguy.netlify.app";
const SECRET = process.env.N64_PREVIEW_LEADERBOARD_SECRET || "";
const MAX_AGE_MS = 3 * 60 * 1000;
const DIFFICULTY = 12;
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const reply = (statusCode, data) => ({
  statusCode, headers: HEADERS, body: JSON.stringify(data),
});
const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

function safePreviewEvent(event) {
  if (!SECRET || SECRET.length < 16) return false;
  const headers = event?.headers || {};
  const host = String(headers.host || "").toLowerCase().split(":")[0];
  const origin = String(headers.origin || "");
  // Require both, rather than accepting user-supplied "preview" flags.
  return host === PREVIEW_HOST && origin === PREVIEW_ORIGIN;
}
function fingerprint(event) {
  const h = event.headers || {};
  const ip = String(h["x-nf-client-connection-ip"]
    || event.requestContext?.identity?.sourceIp
    || h["x-forwarded-for"] || "unknown").split(",")[0].trim().slice(0, 100);
  const agent = String(h["user-agent"] || "").slice(0, 200);
  return hash(ip + "|" + agent);
}
// Netlify may expose a different client-IP header when an Edge Function
// forwards a request to a Function. Bind a ticket to the stable browser
// User-Agent instead; retain IP+UA limits on challenge issue and redemption.
function browserBinding(event) {
  return hash("preview-browser-v2:" +
    String(event?.headers?.["user-agent"] || "").slice(0, 200));
}
function store() {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
  if (!siteID || !token) throw new Error("Preview security store unavailable");
  return getStore({
    name: "n64-preview-booking-security-v1",
    siteID, token, consistency: "strong",
  });
}
function sign(payload) {
  return crypto.createHmac("sha256", SECRET)
    .update("preview-booking:" + payload).digest("base64url");
}
function safeSignature(raw, signature) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(signature || ""))) return false;
  const expected = Buffer.from(sign(raw), "base64url");
  let provided;
  try { provided = Buffer.from(signature, "base64url"); } catch { return false; }
  return expected.length === provided.length &&
    crypto.timingSafeEqual(expected, provided);
}
async function allowed(storeRef, fp, operation) {
  // Two independent rate windows. No IP address or email is stored.
  const now = Date.now();
  const windows = [
    { duration: 60000, max: operation === "issue" ? 5 : 8 },
    { duration: 3600000, max: operation === "issue" ? 25 : 35 },
  ];
  for (const policy of windows) {
    const slot = Math.floor(now / policy.duration);
    const key = "rate:" + operation + ":" + policy.duration + ":" + slot + ":" + fp;
    const item = await storeRef.get(key, { type: "json" });
    if (Number(item?.count || 0) >= policy.max) return false;
    await storeRef.setJSON(key, { count: Number(item?.count || 0) + 1, time: now });
  }
  return true;
}
function hasWork(ticket, value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 200000) return false;
  const digest = crypto.createHash("sha256").update(ticket + ":" + number).digest();
  return digest[0] === 0 && (digest[1] & 0xf0) === 0;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { error: "Method not allowed" });
  if (!safePreviewEvent(event)) return reply(403, { error: "Not a preview booking" });
  try {
    const fp = fingerprint(event);
    const blob = store();
    if (!await allowed(blob, fp, "issue")) {
      return reply(429, { error: "Too many preview checks. Try again later." });
    }
    const payload = {
      s: "preview-booking",
      v: 2,
      t: Date.now(),
      n: crypto.randomBytes(16).toString("hex"),
      f: browserBinding(event),
    };
    const raw = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return reply(200, { ticket: raw + "." + sign(raw), difficulty: DIFFICULTY });
  } catch (error) {
    console.warn("Preview booking challenge unavailable:", error?.name || "error");
    return reply(503, { error: "Preview booking security temporarily unavailable" });
  }
};

exports.verifyPreviewBooking = async (event, proof) => {
  if (!safePreviewEvent(event)) return { ok: false, reason: "preview_origin" };
  if (!proof || typeof proof.ticket !== "string" || proof.ticket.length > 800) {
    return { ok: false, reason: "missing_preview_challenge" };
  }
  const parts = proof.ticket.split(".");
  if (parts.length !== 2 || !safeSignature(parts[0], parts[1])) {
    return { ok: false, reason: "invalid_preview_signature" };
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid_preview_payload" };
  }
  const age = Date.now() - Number(payload.t);
  if (payload.s !== "preview-booking" || payload.v !== 2 ||
      typeof payload.n !== "string" || !/^[a-f0-9]{32}$/.test(payload.n) ||
      payload.f !== browserBinding(event) ||
      !Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) {
    return { ok: false, reason: "preview_challenge_expired_or_changed" };
  }
  if (!hasWork(proof.ticket, proof.work)) {
    return { ok: false, reason: "invalid_preview_work" };
  }
  try {
    const blob = store();
    if (!await allowed(blob, fingerprint(event), "verify")) {
      return { ok: false, reason: "preview_rate_limited" };
    }
    const key = "used:" + payload.n;
    if (await blob.get(key, { type: "json" })) {
      return { ok: false, reason: "preview_replayed" };
    }
    await blob.setJSON(key, { consumed: Date.now() });
    return { ok: true, reason: "preview_signed_challenge" };
  } catch (error) {
    console.warn("Preview booking verification unavailable:", error?.name || "error");
    return { ok: false, reason: "preview_storage_unavailable" };
  }
};
