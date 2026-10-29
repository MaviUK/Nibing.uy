const crypto = require("node:crypto");
const { getStore } = require("@netlify/blobs");
const { verifyBooking, bookingPoints } = require("./lib/arcadeBookingProof");

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const out = (statusCode, data) => ({
  statusCode,
  headers: HEADERS,
  body: JSON.stringify(data),
});

const LEVEL_KEYS = new Set([
  "l:what-we-do", "l:the-process", "l:bins-we-clean", "l:why-clean-your-bin",
  "l:why-ni-bin-guy", "l:areas-we-cover", "l:customer-portal", "l:level-08-final",
]);

const limitInt = (value, max) =>
  Math.min(max, Math.max(0, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0));

function storePair() {
  // The two stores have deliberately different names to keep public ranking
  // data separate from private, opt-in booking/prize contact information.
  return {
    public: getStore({ name: "n64-preview-arcade-public", consistency: "strong" }),
    private: getStore({ name: "n64-preview-arcade-private", consistency: "strong" }),
  };
}

async function topTen(store) {
  const records = [];
  let cursor;
  do {
    const page = await store.list({ prefix: "player:", paginate: true, cursor });
    for (const blob of page.blobs || []) {
      const row = await store.get(blob.key, { type: "json" });
      if (row && typeof row.displayName === "string") {
        records.push(row);
      }
    }
    cursor = page.cursor;
  } while (cursor && records.length < 500);

  return records
    .sort((a, b) => limitInt(b.points, 100000) - limitInt(a.points, 100000)
      || String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
    .slice(0, 10)
    .map((row, index) => ({
      rank: index + 1,
      name: row.displayName,
      points: limitInt(row.points, 100000),
    }));
}

function activityXP(claimed) {
  // The activity keys are capped, deduplicated and counted once each.
  // They represent browser-reported participation, NOT security-grade proof.
  const keys = new Set(Array.isArray(claimed) ? claimed.filter(x => typeof x === "string") : []);
  let levels = 0;
  for (const key of LEVEL_KEYS) if (keys.has(key)) levels += 1;
  return levels * 50 + (keys.has("a:coverage") ? 25 : 0)
    + (keys.has("a:bin-checker") ? 35 : 0);
}

async function notifyOwner(booking, points) {
  if (!process.env.RESEND_API_KEY) return;
  try {
    const { Resend } = require("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: process.env.RESEND_FROM || "Ni Bin Guy <noreply@nibing.uy>",
      to: process.env.BOOKINGS_TO || "info@nibing.uy",
      subject: "NI Bin Guy arcade leaderboard - prize entry",
      text: [
        "A customer opted in to the arcade leaderboard/prize entry.",
        "Name: " + booking.name,
        "Email: " + booking.email,
        "Phone: " + booking.phone,
        "Address: " + booking.address,
        "Booking reference: " + booking.id,
        "Total XP: " + points,
        "Consent: public name/XP, private contact for prize fulfilment.",
        "Consent recorded: " + new Date().toISOString(),
      ].join("\n"),
    });
    if (result?.error) console.warn("Prize entry email could not be sent");
  } catch (_) {
    // The stored entry remains valid if the optional email notice fails.
    console.warn("Prize entry email service temporarily unavailable");
  }
}

exports.handler = async (event) => {
  if (!["GET", "POST"].includes(event.httpMethod)) {
    return out(405, { error: "Method not allowed" });
  }

  try {
    const stores = storePair();
    if (event.httpMethod === "GET") {
      return out(200, { entries: await topTen(stores.public) });
    }

    if (typeof event.body !== "string" || event.body.length > 16000) {
      return out(400, { error: "Invalid leaderboard request" });
    }

    let body;
    try {
      body = JSON.parse(event.body);
    } catch (_) {
      return out(400, { error: "Invalid leaderboard JSON" });
    }
    if (!body || body.consent !== true) {
      return out(400, { error: "Prize leaderboard consent required" });
    }

    const booking = verifyBooking(body.bookingProof);
    if (!booking) {
      return out(403, { error: "A completed verified booking is required" });
    }
    const name = String(booking.name || "").replace(/[<>]/g, "").trim().slice(0, 45);
    if (!name) return out(400, { error: "Missing booking customer name" });

    const emailKey = crypto.createHash("sha256")
      .update(String(booking.email).trim().toLowerCase())
      .digest("hex");
    const recordKey = "player:" + emailKey;

    const [oldPublic, oldPrivate] = await Promise.all([
      stores.public.get(recordKey, { type: "json" }),
      stores.private.get(recordKey, { type: "json" }),
    ]);
    const previousScore = limitInt(oldPublic?.points, 100000);
    const currentActivity = activityXP(body.claimed);
    // Existing 2026 preview records had no progressXP field. We assume that
    // their previously displayed total already included current activity, so
    // upgrading does not accidentally double-award the same levels.
    const previousActivity = oldPrivate
      ? limitInt(oldPrivate.progressXP === undefined ? currentActivity : oldPrivate.progressXP, 460)
      : 0;
    const nextActivity = Math.max(currentActivity, previousActivity);
    const activityIncrease = Math.max(0, nextActivity - previousActivity);

    const knownBookingIds = new Set(
      (Array.isArray(oldPrivate?.bookingIds) ? oldPrivate.bookingIds : [])
        .filter(id => typeof id === "string").slice(-100)
    );
    if (typeof oldPrivate?.bookingId === "string") {
      knownBookingIds.add(oldPrivate.bookingId);
    }
    const firstTimeForBooking = !knownBookingIds.has(booking.id);
    const earnedForBooking = firstTimeForBooking
      ? Math.min(30000, limitInt(bookingPoints(booking.bins), 30000))
      : 0;

    // First registration includes activity + its booking. Later legitimate
    // bookings ADD per-bin XP, not just the larger of two snapshot totals.
    const points = Math.min(100000,
      oldPublic
        ? previousScore + activityIncrease + earnedForBooking
        : currentActivity + earnedForBooking
    );

    const now = new Date().toISOString();
    const publicRow = {
      displayName: name,
      points,
      createdAt: oldPublic?.createdAt || now,
    };
    if (firstTimeForBooking) knownBookingIds.add(booking.id);

    const privateRow = {
      name: String(booking.name),
      email: String(booking.email),
      phone: String(booking.phone || ""),
      address: String(booking.address || ""),
      bookingId: String(booking.id),
      bookingIds: [...knownBookingIds].slice(-100),
      progressXP: nextActivity,
      points,
      consentedAt: oldPrivate?.consentedAt || now,
      lastUpdatedAt: now,
    };

    await stores.private.setJSON(recordKey, privateRow);
    await stores.public.setJSON(recordKey, publicRow);

    if (firstTimeForBooking) {
      await notifyOwner(booking, points);
    }
    return out(200, {
      success: true,
      points,
      displayName: name,
      duplicate: !firstTimeForBooking,
    });
  } catch (error) {
    console.error("Arcade leaderboard failed:", error?.message || "unknown error");
    return out(503, { error: "Leaderboard temporarily unavailable" });
  }
};
