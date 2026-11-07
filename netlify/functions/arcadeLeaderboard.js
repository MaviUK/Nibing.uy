const crypto = require("node:crypto");
const { getStore } = require("@netlify/blobs");
const historical = require("./lib/squeegeeActiveLeaderboardImport");
const historicalPreview = require("./lib/squeegeeActivePreviewBoard");
const nameConsents = require("./lib/squeegeeLeaderboardNameConsent");
const customerHQ = require("./lib/customerHQ");
const arcadeMerge = require("./lib/arcadeCustomerMerge");
const yearlyPreview = require("./lib/squeegeeYearlyPreviewBoard");
const publicRecords = require("./lib/squeegeePublicAchievementHighlights");
const { publicCustomerReference, townFromAddress, safePublicTown, safePublicReference } =
  require("./lib/arcadePublicIdentity");
const {
  signBooking, verifyBooking, bookingPoints, signPlayerSession, verifyPlayerSession
} = require("./lib/arcadeBookingProof");

const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
const out = (statusCode, data) => ({
  statusCode, headers: HEADERS, body: JSON.stringify(data),
});
const SNAPSHOT_KEY = "leaderboard:top10:v3-ref-town";
const SNAPSHOT_MAX_AGE_MS = 35000;
const LEVEL_KEYS = new Set([
  "l:what-we-do", "l:the-process", "l:bins-we-clean", "l:why-clean-your-bin",
  "l:why-ni-bin-guy", "l:areas-we-cover", "l:customer-portal", "l:level-08-final",
]);
const limitInt = (value, max) =>
  Math.min(max, Math.max(0, Number.isFinite(Number(value)) ? Math.floor(Number(value)) : 0));

function storePair() {
  // This Netlify site already provisions explicit Blobs credentials for its
  // booking-status functions. Reuse the same known-working setup here.
  // Netlify's automatic injection may not be available on deploy previews.
  const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
  const open = (name) => {
    const options = { name, consistency: "strong" };
    if (siteID && token) {
      options.siteID = siteID;
      options.token = token;
    }
    return getStore(options);
  };
  return {
    public: open("n64-preview-arcade-public"),
    private: open("n64-preview-arcade-private"),
    history: open(historical.BLOB_STORE),
    links: open("n64-preview1-squeegee-player-links"),
    names: open(nameConsents.STORE_NAME),
    portal: open(customerHQ.DATA_STORE),
    activity: open(arcadeMerge.STORE),
  };
}

function activityXP(claimed) {
  if (!Array.isArray(claimed) || claimed.length > 200) return 0;
  // Browser-reported participation is capped, but is NOT fraud-proof.
  const keys = new Set(claimed.filter((x) => typeof x === "string"));
  let levels = 0;
  for (const key of LEVEL_KEYS) if (keys.has(key)) levels++;
  return levels * 50 + (keys.has("a:coverage") ? 25 : 0)
    + (keys.has("a:bin-checker") ? 35 : 0);
}

async function rebuildSnapshot(stores) {
  // Old caches may contain legacy names; remove the obsolete cache, leaving
  // player scores untouched. Public GET never reads a v2 snapshot.
  try { await stores.public.delete("leaderboard:top10:v2"); } catch (_) {}
  // The old v2 snapshot is NEVER read. Existing points are retained.
  const { blobs = [] } = await stores.public.list({ prefix: "player:" });
  const records = [];
  for (let i = 0; i < blobs.length; i += 20) {
    const rows = await Promise.all(blobs.slice(i, i + 20).map(async ({ key, etag }) => {
      if (typeof key !== "string" || !/^player:[a-f0-9]{64}$/.test(key)) return null;
      const customerRef = publicCustomerReference(key.slice("player:".length));
      if (!customerRef) return null;
      try {
        const row = await stores.public.get(key, { type: "json" });
        if (!row || !Number.isFinite(Number(row.points))) return null;
        let town = safePublicTown(row.town);
        if (town === "Town unavailable") {
          // Legacy entries may contain a full name. Only read the PRIVATE
          // address to derive the town; neither address nor name is returned.
          const privateRow = await stores.private.get(key, { type: "json" });
          if (!privateRow || !(privateRow.enrolledAt || privateRow.consentedAt))
            return null;
          town = townFromAddress(privateRow.address);
        }
        const safeRecord = {
          customerRef, town, points: limitInt(row.points, 100000),
          createdAt: row.createdAt || "", lastUpdatedAt: row.lastUpdatedAt || "",
        };
        if (typeof row.displayName === "string" && typeof etag === "string" && etag.length >= 4) {
          // Best-effort removal of names from legacy PUBLIC Blob records.
          // Conditional ETag write avoids overwriting XP earned concurrently.
          // If the CAS loses the race, no name is returned to the browser.
          try { await stores.public.setJSON(key, safeRecord, { onlyIfMatch: etag }); }
          catch (_) {}
        }
        return safeRecord;
      } catch (_) { return null; }
    }));
    for (const row of rows) if (row) records.push(row);
  }
  const ranked = records.sort((a, b) =>
    limitInt(b.points, 100000) - limitInt(a.points, 100000) ||
    String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
  );
  const snapshot = {
    entries: ranked.slice(0, 10).map((row, i) => ({
      rank: i + 1, customerRef: row.customerRef, town: row.town,
      points: limitInt(row.points, 100000),
    })),
    totalPlayers: ranked.length,
    lastUpdatedAt: records.reduce((last, row) => {
      const t = row.lastUpdatedAt || row.createdAt || "";
      return t > last ? t : last;
    }, "") || null,
    builtAt: new Date().toISOString(),
  };
  try { await stores.public.setJSON(SNAPSHOT_KEY, snapshot); }
  catch (error) {
    console.warn("Leaderboard snapshot cache write failed:", error?.message || "unknown");
  }
  return snapshot;
}

async function getSnapshot(stores) {
  const cached = await stores.public.get(SNAPSHOT_KEY, { type: "json" });
  const age = Date.now() - Date.parse(cached?.builtAt || "");
  if (Array.isArray(cached?.entries) &&
      cached.entries.every(e => safePublicReference(e?.customerRef) &&
        safePublicTown(e?.town) === e?.town && Number.isFinite(Number(e?.points))) &&
      Number.isFinite(age) && age >= 0 && age < SNAPSHOT_MAX_AGE_MS) {
    return cached;
  }
  return rebuildSnapshot(stores);
}

async function getActiveHistoricalBoard(stores) {
  const snapshot=await stores.history.get(historical.PUBLISHED_KEY,{type:"json",consistency:"strong"});
  if(!snapshot || snapshot.published!==true){
    const mode=await stores.history.get(historical.MODE_KEY,{type:"json",consistency:"strong"});
    // Once active-only mode has been enabled, unpublishing a history
    // snapshot must never fall back to unverified website-only players.
    return mode?.activeOnly===true
      ? {entries:[],totalPlayers:0,lastUpdatedAt:null,
         status:"active_status_refresh_required"}:null;
  }
  if(snapshot.version!==2 || !historical.snapshotIsFresh(snapshot)) {
    // A previously published one-point (v1) mapping cannot override the
    // owner's newer streak scale. It must be re-imported as scoring v2.
    return {entries:[],totalPlayers:0,sourceAsOf:snapshot.asOf,
      lastUpdatedAt:snapshot.importedAt,status:"active_status_refresh_required"};
  }
  const scores=new Map();
  const collisions=new Set();
  // Only a VERIFIED Squeegee UUID link may combine existing website XP.
  // Never join on email, name, town or a reusable customer reference alone.
  const activeIds=new Set(historical.eligibleHistoricalEntries(snapshot).map(e=>e.squeegeeId));
  const listed=await stores.links.list({prefix:"player:"});
  for(const {key} of (listed?.blobs||[]).slice(0,5000)) {
    if(!/^player:[a-f0-9]{64}$/.test(key))continue;
    try {
      const link=await stores.links.get(key,{type:"json"});
      const uuid=String(link?.squeegeeId||"").toLowerCase();
      if(!activeIds.has(uuid) || link?.verified!==true)continue;
      if(scores.has(uuid)) {collisions.add(uuid);continue;}
      const player=await stores.public.get(key,{type:"json"});
      const points=limitInt(player?.points,100000);
      scores.set(uuid,points);
    } catch (_) {}
  }
  // One shared Squeegee account cannot accumulate XP from two email players
  // without an owner-reviewed identity resolution.
  for(const uuid of collisions)scores.delete(uuid);
  const board=historical.combinedPublicBoard(snapshot,scores);
  return {...board,status:"squeegee_active_only"};
}

// Source snapshots are strictly scoped to the historical N64 deploy preview.
// The live nibing.uy API must never adopt a dated seed from a GitHub branch.
function isExactN64PreviewRequest(event) {
  const host=String(event?.headers?.host||event?.headers?.Host||"").toLowerCase();
  return host==="deploy-preview-77--nibinguy.netlify.app";
}

function publicLeaderboard(snapshot) {
  // Strict allowlist: no cached name, contact, address or invoice fields.
  return {
    entries: (Array.isArray(snapshot?.entries) ? snapshot.entries : [])
      .filter(e => safePublicReference(e?.customerRef))
      .slice(0,["public_eligible_scores","preview_public_first_names"].includes(snapshot?.status)?700:10)
      .map((e,i)=>({
        rank: i + 1, customerRef: e.customerRef, town: safePublicTown(e.town),
        points: limitInt(e.points, 100000),
        ...(snapshot?.status==="public_eligible_scores" && e.anonymous===true
          ?{anonymous:true}:{}),
        ...((snapshot?.status==="consent_only" ||
              snapshot?.status==="public_eligible_scores" ||
              snapshot?.status==="preview_public_first_names") &&
          nameConsents.safeFirstName(e.displayName)
          ? {displayName:e.displayName}:{}),
      })),
    totalPlayers: limitInt(snapshot?.totalPlayers, 1000000),
    lastUpdatedAt: typeof snapshot?.lastUpdatedAt === "string"
      ? snapshot.lastUpdatedAt : null,
    ...(typeof snapshot?.sourceAsOf === "string"?{sourceAsOf:snapshot.sourceAsOf}:{}),
    ...(["active_status_refresh_required","eligibility_pending",
         "consent_pending","consent_only","public_eligible_scores",
         "preview_public_first_names"]
       .includes(snapshot?.status)?{status:snapshot.status}:{}),
    ...(snapshot?.status==="public_eligible_scores"
      ?{publicNamedCount:limitInt(snapshot?.approvedCount,700)}:{}),
    ...(snapshot?.status==="preview_public_first_names"
      ?{publicNamedCount:limitInt(snapshot?.namedCount,700),testPreview:true}:{}),
  };
}
async function refreshSnapshotAfterWrite(stores) {
  try { await rebuildSnapshot(stores); }
  catch (error) {
    console.warn("Leaderboard snapshot refresh failed:", error?.message || "unknown");
  }
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
        "Consent: public customer reference/town/XP, private contact for prize fulfilment.",
        "Consent recorded: " + new Date().toISOString(),
      ].join("\n"),
    });
    if (result?.error) console.warn("Prize entry email could not be sent");
  } catch (_) {
    console.warn("Prize entry email service temporarily unavailable");
  }
}

async function updateActivePlayer(body, stores) {
  // An opted-in booking receives a 90-day signed, pseudonymous session.
  // Updating XP never resends a customer's name or contact details.
  const key = verifyPlayerSession(body.playerToken);
  if (!key) return out(401, { error: "Score session expired or invalid" });
  const recordKey = "player:" + key;
  const [player, contact] = await Promise.all([
    stores.public.get(recordKey, { type: "json" }),
    stores.private.get(recordKey, { type: "json" }),
  ]);
  if (!player || !(contact?.enrolledAt || contact?.consentedAt)) {
    return out(403, { error: "A confirmed enrolled booking is required" });
  }
  const previousActivity = limitInt(contact.progressXP, 460);
  const nextActivity = Math.max(previousActivity, activityXP(body.claimed));
  const earned = nextActivity - previousActivity;
  const oldPoints = limitInt(player.points, 100000);
  const customerRef = publicCustomerReference(key);
  if (!customerRef) return out(503, { error: "Leaderboard reference unavailable" });
  if (!earned) return out(200, { success: true, changed: false, points: oldPoints });
  const points = Math.min(100000, oldPoints + earned);
  const timestamp = new Date().toISOString();
  await stores.private.setJSON(recordKey, {
    ...contact, points, progressXP: nextActivity, lastUpdatedAt: timestamp,
  });
  await stores.public.setJSON(recordKey, {
    customerRef,
    town: safePublicTown(player.town) === "Town unavailable"
      ? townFromAddress(contact.address) : safePublicTown(player.town),
    points, createdAt: player.createdAt || timestamp, lastUpdatedAt: timestamp,
  });
  await refreshSnapshotAfterWrite(stores);
  return out(200, { success: true, changed: true, points });
}

async function registerBooking(body, stores, internalAuto = false) {
  if (!internalAuto && body.consent !== true) return out(400, { error: "Prize leaderboard consent required" });
  const booking = verifyBooking(body.bookingProof);
  if (!booking) return out(403, { error: "A completed verified booking is required" });
  const name = String(booking.name || "").replace(/[<>]/g, "").trim().slice(0, 45);
  if (!name) return out(400, { error: "Missing booking customer name" });
  const emailKey = crypto.createHash("sha256")
    .update(String(booking.email).trim().toLowerCase()).digest("hex");
  const recordKey = "player:" + emailKey;
  const customerRef = publicCustomerReference(emailKey);
  if (!customerRef) return out(503, { error: "Leaderboard reference unavailable" });
  const town = townFromAddress(booking.address);

  const [oldPublic, oldPrivate] = await Promise.all([
    stores.public.get(recordKey, { type: "json" }),
    stores.private.get(recordKey, { type: "json" }),
  ]);
  const currentActivity = activityXP(body.claimed);
  const previousActivity = oldPrivate
    ? limitInt(oldPrivate.progressXP === undefined ? currentActivity : oldPrivate.progressXP, 460)
    : 0;
  const activityIncrease = Math.max(0, currentActivity - previousActivity);
  const nextActivity = Math.max(currentActivity, previousActivity);
  const bookingIds = new Set(
    (Array.isArray(oldPrivate?.bookingIds) ? oldPrivate.bookingIds : [])
      .filter((id) => typeof id === "string").slice(-2000)
  );
  if (typeof oldPrivate?.bookingId === "string") bookingIds.add(oldPrivate.bookingId);
  const newBooking = !bookingIds.has(booking.id);
  const bookingIncrease = newBooking
    ? Math.min(30000, limitInt(bookingPoints(booking.bins), 30000)) : 0;
  const previousScore = limitInt(oldPublic?.points || oldPrivate?.points, 100000);
  const points = Math.min(100000,
    oldPublic ? previousScore + activityIncrease + bookingIncrease
      : currentActivity + bookingIncrease
  );
  const timestamp = new Date().toISOString();
  const changed = !oldPublic || newBooking || activityIncrease > 0;
  if (newBooking) bookingIds.add(booking.id);
  // Preserve a separate dated record for every confirmed website booking.
  const existingAwards = Array.isArray(oldPrivate?.bookingAwards)
    ? oldPrivate.bookingAwards.filter(a => a && typeof a.id === "string" &&
      Number.isSafeInteger(a.points) && a.points > 0).slice(-1999) : [];
  const newAward = newBooking && bookingIncrease > 0 ? {
    id: String(booking.id),points:bookingIncrease,at:timestamp,
    binCount:Math.min(10000,(Array.isArray(booking.bins)?booking.bins:[])
      .reduce((sum,bin)=>sum+limitInt(bin?.count,100),0)),
  } : null;
  const bookingAwards = newAward
    ? existingAwards.concat(newAward) : existingAwards;

  if (changed) {
    await stores.private.setJSON(recordKey, {
      name: String(booking.name),
      email: String(booking.email),
      phone: String(booking.phone || ""),
      address: String(booking.address || ""),
      bookingId: String(booking.id),
      bookingIds: [...bookingIds].slice(-2000),
      bookingAwards,
      progressXP: nextActivity,
      points,
      ...(internalAuto ? {} : { consentedAt: oldPrivate?.consentedAt || timestamp }),
      enrolledAt: oldPrivate?.enrolledAt || oldPrivate?.consentedAt || timestamp,
      enrollmentMethod: internalAuto ? "automatic-after-booking-notice" : "explicit-opt-in",
      lastUpdatedAt: timestamp,
    });
    await stores.public.setJSON(recordKey, {
      customerRef, town, points,
      createdAt: oldPublic?.createdAt || timestamp, lastUpdatedAt: timestamp,
    });
    await refreshSnapshotAfterWrite(stores);
    // The normal booking email already informs the owner and includes all private details.
    if (newBooking && !internalAuto) await notifyOwner(booking, points);
  }

  return out(200, {
    success: true,
    changed,
    duplicate: !newBooking,
    points,
    customerRef,
    town,
    playerToken: signPlayerSession(emailKey),
  });
}

/**
 * INTERNAL server-to-server entry point, only called after a booking email
 * or WhatsApp booking has been accepted. This is NOT a public API action.
 * Customers are automatically listed unless they selected "stay private"
 * before booking. Never includes their email or phone in the public result.
 */
exports.autoEnrollBooking = async function autoEnrollBooking(payload) {
  if (payload?.arcadeOptOut === true) {
    return { registered: false, optedOut: true };
  }
  const proof = signBooking(payload);
  if (!proof) throw new Error("A confirmed booking is required for arcade enrolment");
  const response = await registerBooking({
    bookingProof: proof,
    claimed: Array.isArray(payload.arcadeClaimed) ? payload.arcadeClaimed : [],
  }, storePair(), true);
  const body = JSON.parse(response.body);
  if (response.statusCode !== 200 || !body?.success) {
    throw new Error("Failed to save arcade player: " + response.statusCode);
  }
  return {
    registered: true,
    playerToken: body.playerToken,
    customerRef: body.customerRef,
    town: body.town,
    points: body.points,
    duplicate: body.duplicate,
  };
};

exports.handler = async (event) => {
  if (!["GET", "POST"].includes(event.httpMethod)) {
    return out(405, { error: "Method not allowed" });
  }
  try {
    const stores = storePair();
    if (event.httpMethod === "GET") {
      if(isExactN64PreviewRequest(event)){
        const now=Date.now();
        const rawYear=event.queryStringParameters?.year;
        const years=yearlyPreview.availableYears(now);
        let annualYear=null;
        if(rawYear!==undefined && rawYear!==null){
          if(typeof rawYear!=="string"||!/^\d{4}$/.test(rawYear)||
             !yearlyPreview.validYear(Number(rawYear),now))
            return out(400,{error:"invalid_leaderboard_year"});
          annualYear=Number(rawYear);
        }
        const period=annualYear===null?"overall":String(annualYear);
        // EMAIL REQUIRED: the ONLY trusted eligibility data is the private
        // owner-imported active Squeegee snapshot; no public seed fallback.
        // Read independent private snapshots concurrently to remove one
        // network waterfall. Never cache the consent ledger: withdrawals
        // must be checked on every public leaderboard request.
        const [privateCustomers,privateNames,mode,published]=await Promise.all([
          stores.portal.get(customerHQ.DATA_KEY,{type:"json",consistency:"strong"}),
          stores.names.get(nameConsents.KEY,{type:"json",consistency:"strong"}),
          stores.history.get(historical.MODE_KEY,{type:"json",consistency:"strong"}),
          stores.history.get(historical.PUBLISHED_KEY,{type:"json",consistency:"strong"}),
        ]);
        const eligible=customerHQ.eligibleRankedEmailAccounts(privateCustomers);
        const scoreUpdatePending=privateCustomers?.scoringVersion===
          "2026-11-streak-20-plus-2-per-paid-bin-v1";
        if(!eligible){
          return out(200,{...publicLeaderboard({
            entries:[],totalPlayers:0,status:"eligibility_pending"
          }),period,availableYears:years});
        }
        const annualCleaningTotal=annualYear===null?eligible.historicalPoints:
          privateCustomers.accounts.reduce((sum,account)=>
            eligible.aliases.has(historical.canonicalLegacyRef(account.id))
              ?sum+yearlyPreview.annualCleaningXP(
                account.events,annualYear,privateCustomers.asOf):sum,0);
        if(mode?.activeOnly===true && !published){
          // The owner's previous HIDE action is authoritative for every year.
          return out(200,{...publicLeaderboard({
            entries:[],totalPlayers:0,status:"consent_pending"
          }),eligiblePlayers:eligible.count,
            verifiedPlayers:eligible.verifiedCount,
            verifiedActiveAccounts:eligible.verifiedActiveEmailAccounts,
            verifiedAsOf:eligible.verificationAsOf,
            eligibleCleaningXp:annualCleaningTotal,
            scoreUpdatePending,period,availableYears:years});
        }
        // All periods, including Overall, use only verified earning dates.
        // Legacy XP without earning dates is excluded, not reassigned.
        // The same secret-keyed public first-name wrapper protects both.
        const privateKey=customerHQ.secret(process.env);
        if(!privateKey)return out(503,{error:"leaderboard_secret_unavailable"});
        const full=annualYear===null
          ?(await yearlyPreview.getDatedScoreBoards(
            stores,privateCustomers,eligible.aliases,now)).overallBoard
          :await yearlyPreview.getAnnualPreviewBoard(
            stores,privateCustomers,eligible.aliases,annualYear,now);
        const publicScores=nameConsents.previewFirstNameScoreboard(
          privateCustomers,full,eligible.aliases,privateNames,privateKey
        );
        // Use ONLY the first name, town and XP already visible on this
        // exact public year leaderboard. Recheck withdrawals every request;
        // do not expose source refs, job IDs, emails or private history.
        const publicAchievements=publicScores?.status==="preview_public_first_names"&&
          Array.isArray(publicScores.entries)&&publicScores.entries.length>0
          ?publicRecords.highlights(
            privateCustomers,eligible.aliases,privateNames,period,
            publicScores,privateKey
          ):null;
        return out(200,{...publicLeaderboard(publicScores||{
          entries:[],totalPlayers:0,status:"eligibility_pending"
        }),...(publicAchievements?{publicAchievements}:{}),
          eligiblePlayers:eligible.count,
          verifiedPlayers:eligible.verifiedCount,
          verifiedActiveAccounts:eligible.verifiedActiveEmailAccounts,
          verifiedAsOf:eligible.verificationAsOf,
          eligibleCleaningXp:annualCleaningTotal,
          scoreUpdatePending,period,availableYears:years});
      }
      const activeBoard=await getActiveHistoricalBoard(stores);
      // Production/non-Preview hosts retain the existing website-only board.
      // The exact N64 Preview host has already returned above using the
      // owner-imported, email-eligible public scoreboard, with consent-gated names.
      return out(200,publicLeaderboard(activeBoard||await getSnapshot(stores)));
    }
    if (typeof event.body !== "string" || event.body.length > 16000) {
      return out(400, { error: "Invalid leaderboard request" });
    }
    let body;
    try { body = JSON.parse(event.body); }
    catch (_) { return out(400, { error: "Invalid leaderboard JSON" }); }
    if (!body || typeof body !== "object") {
      return out(400, { error: "Invalid leaderboard request" });
    }
    if (body.action === "sync") return updateActivePlayer(body, stores);
    return registerBooking(body, stores);
  } catch (error) {
    console.error("Arcade leaderboard error:", error?.message || "unknown");
    return out(503, { error: "Leaderboard temporarily unavailable" });
  }
};
