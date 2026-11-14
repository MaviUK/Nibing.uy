const BOOKING_TERMS = require("../../src/data/bookingTerms.json");
// netlify/functions/sendBookingEmail.js

const { signBooking } = require("./lib/arcadeBookingProof");
const { autoEnrollBooking } = require("./arcadeLeaderboard");
const { verifyPreviewBooking } = require("./previewBookingChallenge");
const { buildTermsAcceptancePdfAttachment } = require("./lib/termsPdf");
const { annualBookingBreakdown } = require("./lib/annualBookingBreakdown");
const { buildBookingEmailHtml, bookingReceiptDates } = require("./lib/bookingEmailTemplate");
const { buildOwnerTermsSummary } = require("./lib/ownerBookingTermsSummary");
const ownerCertificate=require("./lib/squeegeeOwnerCertificate");
const { validateBookingSubmission, claimBookingSubmission, submissionErrorResponse } = require("./lib/bookingSubmissionGuard");
const { stageWithoutBlockingBooking } = require("./lib/squeegeeBookingStage");
const {
  dispatchAcceptedBooking,autoDispatchConfigured,normalOwnerReceipt,
}=require("./lib/squeegeePreviewAutoDispatch");
const rollout=require("./lib/squeegeePreviewAutoRollout");
const productionGuard=require("./lib/squeegeeProductionGuard");
const productionDispatch=require("./lib/squeegeeProductionDispatch");
const {emailContent:buildOwnerReviewEmail}=
  require("./lib/squeegeeSyncOwnerAlert");
const { normaliseUkBookingPhone } = require("./lib/ukBookingPhone");
const { validateCommercialBinSizes } = require("./lib/squeegeeBookingPricing");
const { PILOT_NAME } = require("./lib/squeegeePreviewAutoRollout");
const { recordNoDispatch } = require("./lib/squeegeeBookingReviewTrace");

// Optional audit logging. If Netlify Blobs is unavailable, logging is skipped.
let getStoreSafe = null;
try {
  const { getStore } = require("@netlify/blobs");
  getStoreSafe = function (name,consistency) {
    const siteID = process.env.NETLIFY_SITE_ID || process.env.BLOBS_SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.BLOBS_TOKEN;
    const options={name,...(consistency?{consistency}:{})};
    return siteID && token ?
      getStore({...options,siteID,token}):getStore(options);
  };
} catch (_) {
  // Blobs are optional.
}

// Use Resend's documented HTTP API directly. Netlify's deployed function
// cannot resolve the Resend npm package at runtime.
const resend = { emails: { send: async (message) => {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { data: null, error: { message: "email_provider_unconfigured" } };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ ...message, ...(message.replyTo ? { reply_to: message.replyTo } : {}), replyTo: undefined }),
      signal: AbortSignal.timeout(12000),
    });
    const result = await response.json().catch(() => ({}));
    return response.ok ? { data: result, error: null } :
      { data: null, error: { message: "email_provider_rejected", statusCode: response.status } };
  } catch (_) {
    return { data: null, error: { message: "email_provider_unavailable" } };
  }
} } };

const FROM_DEFAULT = process.env.RESEND_FROM || "Ni Bin Guy <noreply@nibing.uy>";
const TO_ADMIN = process.env.BOOKINGS_TO || "info@nibing.uy";
const TERMS_VERSION_DEFAULT = BOOKING_TERMS.version;
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY || "";
const RECAPTCHA_MIN_SCORE = Number(process.env.RECAPTCHA_MIN_SCORE || "0.5");

const TERMS_BODY = BOOKING_TERMS.body;

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const fmtGBP = (value) => {
  const amount = Math.round((Number(value) || 0) * 100) / 100;
  return `£${amount % 1 === 0 ? amount.toFixed(0) : amount.toFixed(2)}`;
};

function buildPricingBlocks(pricing, discountCode) {
  const code = String(discountCode || "").trim();
  const lines = Array.isArray(pricing?.lines) ? pricing.lines : [];

  if (!lines.length) {
    return {
      applied: false,
      text: `Pricing:\n(No pricing breakdown provided)\n\nDiscount Code: ${code || "None"}`,
      html: `
        <h3 style="margin:16px 0 6px">Pricing</h3>
        <p style="margin:0 0 8px;color:#6b7280">(No pricing breakdown provided)</p>
        <p style="margin:0"><strong>Discount Code:</strong> ${escapeHtml(code || "None")}</p>
      `,
    };
  }

  const applied = Boolean(code && lines.some((line) => Boolean(line.discounted)));
  const textLines = lines.map((line) => {
    const type = String(line.type || "").replace(" Bin", "");
    const badge = line.discounted ? " (discounted)" : "";
    return `${line.count || 1}x ${type} — ${line.planLabel || ""} @ ${fmtGBP(line.unitPrice)}${badge} = ${fmtGBP(line.lineTotal)}`;
  });

  const subtotal = fmtGBP(pricing.subtotal);
  const total = fmtGBP(pricing.total);
  const codeStatus = code ? (applied ? " (applied)" : " (not applied)") : "";

  const htmlLines = lines
    .map((line) => {
      const type = escapeHtml(String(line.type || "").replace(" Bin", ""));
      const badge = line.discounted
        ? ` <span style="color:#059669;font-weight:700">(discounted)</span>`
        : "";
      return `<div style="margin:0 0 6px">${escapeHtml(line.count || 1)}x <strong>${type}</strong> — ${escapeHtml(line.planLabel || "")} @ ${escapeHtml(fmtGBP(line.unitPrice))}${badge} = <strong>${escapeHtml(fmtGBP(line.lineTotal))}</strong></div>`;
    })
    .join("");

  return {
    applied,
    text: `Pricing:\n${textLines.join("\n")}\n\nSubtotal: ${subtotal}\nTotal: ${total}\n\nDiscount Code: ${code || "None"}${codeStatus}`,
    html: `
      <h3 style="margin:16px 0 6px">Pricing</h3>
      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px">
        ${htmlLines}
        <div style="margin-top:10px;border-top:1px solid #e5e7eb;padding-top:10px;display:flex;justify-content:space-between">
          <div style="color:#374151">Subtotal</div><div style="font-weight:700">${escapeHtml(subtotal)}</div>
        </div>
        <div style="margin-top:6px;display:flex;justify-content:space-between">
          <div style="color:#111827;font-weight:700">Total</div><div style="font-weight:800">${escapeHtml(total)}</div>
        </div>
      </div>
      <p style="margin:10px 0 0"><strong>Discount Code:</strong> ${escapeHtml(code || "None")}${code ? (applied ? " <span style='color:#059669;font-weight:700'>(applied)</span>" : " <span style='color:#dc2626;font-weight:700'>(not applied)</span>") : ""}</p>
    `,
  };
}

async function verifyRecaptcha({ token, expectedAction }) {
  if (!RECAPTCHA_SECRET) return { ok: false, reason: "missing_secret" };
  if (!token) return { ok: false, reason: "missing_token" };

  const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: RECAPTCHA_SECRET, response: token }),
  });
  const data = await response.json();

  if (!data?.success) return { ok: false, reason: "not_success", data };
  if (expectedAction && data.action && data.action !== expectedAction) {
    return { ok: false, reason: "action_mismatch", data };
  }
  if (typeof data.score === "number" && data.score < RECAPTCHA_MIN_SCORE) {
    return { ok: false, reason: "low_score", data };
  }

  return { ok: true, data };
}

function buildAuditPromise(details) {
  if (!getStoreSafe) return Promise.resolve();

  return (async () => {
    try {
      const store = getStoreSafe("tos-confirmations");
      const identifier = details.email || details.phone || "unknown";
      const key = `${new Date().toISOString()}__${identifier.replace(/[^a-z0-9@.+_-]/gi, "_")}.json`;
      await store.setJSON(key, details);
    } catch (error) {
      console.warn("Blobs log skipped:", error.message);
    }
  })();
}

exports.handler = async (event) => {
  const startedAt = Date.now();
  // No names, addresses, emails, booking IDs or tokens in performance logs.
  // Each duration measures a real stage, including its network time.
  const timings = {};
  const timed = async (name, fn) => {
    const since = Date.now();
    try { return await fn(); }
    finally { timings[name] = Date.now() - since; }
  };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const payload = JSON.parse(event.body || "{}");
    const recaptchaToken = payload.recaptchaToken || null;
    const recaptchaAction = payload.recaptchaAction || "booking_submit";

    const {
      name = "",
      address = "",
      phone: rawPhone = "",
      email = "",
      bins = [],
      placeId = "",
      lat = null,
      lng = null,
      source = "website",
      discountCode = null,
      pricing = null,
      termsAccepted = false,
      termsVersion = TERMS_VERSION_DEFAULT,
      termsAcceptanceText = `I confirm I’ve read and agree to the Ni Bin Guy Terms of Service (v${TERMS_VERSION_DEFAULT}).`,
      termsTimestamp = new Date().toISOString(),
    } = payload;

    // Website bookings must refer to the currently published agreement.
    if (source === "website" && termsVersion !== TERMS_VERSION_DEFAULT) {
      return {
        statusCode: 428,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({ error: "Reload and accept the September 2026 terms" }),
      };
    }

    // Reject postcodes/non-phone text BEFORE claiming a booking ID, emailing
    // anyone, awarding XP or dispatching any real Squeegee API work.
    const phone=normaliseUkBookingPhone(rawPhone);
    if(!phone) {
      return {
        statusCode:422,
        headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
        body:JSON.stringify({
          error:"Enter a valid UK contact number (e.g. 028 or 07, 11 digits).",
          reason:"invalid_booking_phone",
        }),
      };
    }
    // The independently signed automatic Squeegee worker consumes this
    // accepted payload; keep its contact number canonical and numeric.
    payload.phone=phone;
    // The signed Preview 1 background receipt needs these same accepted
    // agreement details if it sends the ordinary owner email after syncing.
    payload.termsVersion=termsVersion;
    payload.termsTimestamp=termsTimestamp;
    payload.termsAcceptanceText=termsAcceptanceText;
    payload.source=source;

    const filteredBins = (Array.isArray(bins) ? bins : []).filter((bin) => bin?.type);
    const binSizeCheck = validateCommercialBinSizes(filteredBins);
    if (!binSizeCheck.ok) {
      return {
        statusCode: 422,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({
          error: "Choose 660L or 1100L for each large commercial bin.",
          reason: binSizeCheck.reason,
        }),
      };
    }
    const binsText =
      filteredBins
        .map((bin) => {
          const planOrFrequency = bin.planId ? `plan: ${bin.planId}` : bin.frequency || "";
          const size = bin.sizeLitres ? ` (${bin.sizeLitres}L)` : "";
          return `${bin.count || 1} x ${bin.type}${size} (${planOrFrequency})`;
        })
        .join("\n") || "(none provided)";
    const binsHtml =
      filteredBins
        .map((bin) => {
          const planOrFrequency = bin.planId ? `plan: ${escapeHtml(bin.planId)}` : escapeHtml(bin.frequency || "");
          const size = bin.sizeLitres ? ` (${bin.sizeLitres}L)` : "";
          return `${escapeHtml(bin.count || 1)} x ${escapeHtml(bin.type)}${size} (${planOrFrequency})`;
        })
        .join("<br>") || "(none provided)";
    const pricingBlocks = buildPricingBlocks(pricing, discountCode);

    // These two independent network/CPU operations used to run one after the other.
    const [recaptcha, termsPdfAttachment] = await Promise.all([
      // Staging has its own signed, rate-limited test challenge because
      // the production reCAPTCHA key may reject Netlify preview hostnames.
      // Production requests never pass this preview-only verification.
      timed("security", () => payload.previewProof
        ? verifyPreviewBooking(event, payload.previewProof)
        : verifyRecaptcha({ token: recaptchaToken, expectedAction: recaptchaAction })),
      timed("pdf", () => buildTermsAcceptancePdfAttachment({
        name,
        email,
        phone,
        address,
        binsText,
        pricingText: pricingBlocks.text,
        annualBreakdownText: annualBookingBreakdown(pricing),
        termsAccepted,
        termsVersion,
        termsAcceptanceText,
        termsTimestamp,
        termsBody: TERMS_BODY,
        source,
      }).catch((error) => {
        console.warn("Terms PDF generation skipped:", error.message);
        return null;
      })),
    ]);

    if (!recaptcha.ok) {
      console.warn("reCAPTCHA blocked booking:", recaptcha.reason, recaptcha.data || "");
      return {
        statusCode: 403,
        body: JSON.stringify({ error: "Anti-bot check failed" }),
      };
    }
    // A customer cannot accept a booking unless their signed Terms PDF exists.
    // This guard runs BEFORE reserving the reference or sending any email.
    if (!termsPdfAttachment) {
      return {
        statusCode: 424,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({ error: "Terms certificate unavailable; no booking submitted" }),
      };
    }

    // Once the security check has passed, claim this random booking reference.
    // This prevents rapid repeated taps/retries from sending duplicate emails.
    // Claims are deliberately NOT consumed when CAPTCHA verification fails.
    const submission = validateBookingSubmission(payload);
    if (!submission.ok) return submissionErrorResponse(submission);
    // The preview worker must send the owner the SAME PDF already given to
    // the customer. Stage those exact bytes BEFORE accepting the booking.
    const syncHost=String(event?.headers?.host||event?.headers?.Host||"").toLowerCase();
    const isPreview1=syncHost==="deploy-preview-77--nibinguy.netlify.app";
    const isProductionHost=syncHost===productionGuard.PRODUCTION_HOST;
    const productionSyncEnabled=productionDispatch.issuerConfigured(
      process.env,syncHost);
    const previewSyncEnabled=isPreview1 &&
      autoDispatchConfigured(process.env) &&
      rollout.acceptedForRollout(payload,"email",process.env);
    let stagedOwnerPdfSha=null;
    if (previewSyncEnabled || productionSyncEnabled) {
      try {
        if (!getStoreSafe) throw new Error("netlify_blobs_not_available");
        const ownerPdfStart=Date.now();
        const saved=await ownerCertificate.storeCustomerCertificate(
          submission.bookingId,termsPdfAttachment,
          getStoreSafe(productionSyncEnabled?
            productionGuard.CERT_STORE:ownerCertificate.STORE,"strong"));
        timings.ownerPdfStore=Date.now()-ownerPdfStart;
        stagedOwnerPdfSha=saved.sha256;
      } catch (error) {
        console.error("Automatic booking owner certificate staging failed:",error?.message||"unavailable");
        return {
          statusCode: 424,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          body: JSON.stringify({ error: "Terms certificate could not be secured; no booking submitted" }),
        };
      }
    }
    const claimStarted=Date.now();
    const claim = await claimBookingSubmission({
      ...submission, channel: "email", sourceHost: syncHost,
    });
    timings.claim=Date.now()-claimStarted;
    if (!claim.ok) return submissionErrorResponse({ ...submission, ...claim });

    // Both immediate customer and owner emails share this generated PDF.
    // Preview 1 deferred owner delivery rebuilds the same acceptance
    // certificate from the signed original booking details.
    const attachments = termsPdfAttachment ? [termsPdfAttachment] : undefined;
    const ownerTerms=buildOwnerTermsSummary({
      termsAccepted,termsVersion,termsTimestamp,
      pdfAttached:Boolean(termsPdfAttachment),
    });
    const subjectAdmin = `🗑️ New Bin Cleaning Booking (${source})`;
    const textAdmin = `New Bin Cleaning Booking\n\nBooking reference: ${submission.bookingId}\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nAddress: ${address}\n${lat != null && lng != null ? `Geo: ${lat}, ${lng}\n` : ""}${placeId ? `Place ID: ${placeId}\n` : ""}Bins:\n${binsText}\n\n${pricingBlocks.text}\n\n${ownerTerms.text}\n`;
    const htmlAdmin = `
      <h2>New Bin Cleaning Booking</h2>
      <p><strong>Booking reference:</strong> ${escapeHtml(submission.bookingId)}</p>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Address:</strong> ${escapeHtml(address)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      ${lat != null && lng != null ? `<p><strong>Geo:</strong> ${escapeHtml(lat)}, ${escapeHtml(lng)}</p>` : ""}
      ${placeId ? `<p><strong>Place ID:</strong> ${escapeHtml(placeId)}</p>` : ""}
      <p><strong>Bins:</strong><br>${binsHtml}</p>
      ${pricingBlocks.html}
      ${ownerTerms.html}
      <p style="color:#6b7280;font-size:12px;margin-top:12px">Source: ${escapeHtml(source)}</p>
    `;

    const ownerReceipt={
      subject:subjectAdmin,text:textAdmin,html:htmlAdmin,
      replyTo:email||null,termsBody:TERMS_BODY,
      binsText,pricingText:pricingBlocks.text,
    };
    // A signed and separately approved worker sends ONE owner email.
    // Disabled production and all unrelated previews preserve original flow.
    const deferAdminForPreview=previewSyncEnabled &&
      Boolean(normalOwnerReceipt(ownerReceipt));
    const deferAdminForProduction=productionSyncEnabled &&
      Boolean(normalOwnerReceipt(ownerReceipt));
    const deferAdminForAuto=deferAdminForPreview||deferAdminForProduction;
    if (deferAdminForAuto && stagedOwnerPdfSha) {
      ownerReceipt.ownerPdfSha256=stagedOwnerPdfSha;
    }
    const recordAutoNoDispatch=async(details)=>{
      if(!isProductionHost)return recordNoDispatch(
        submission.bookingId,details);
      if(!getStoreSafe)return;
      try{
        await getStoreSafe(productionGuard.STATUS_STORE,"strong").setJSON(
          submission.bookingId,{
            bookingId:submission.bookingId,
            stage:details?.reason==="automatic_sync_not_enabled"?
              "held_for_review":"requires_reconciliation",
            reason:String(details?.reason||"handoff_uncertain").slice(0,90),
            ownerAlertDelivery:details?.ownerAlertDelivery||"not_sent",
            updatedAt:new Date().toISOString(),
          },{onlyIfNew:true});
      }catch{console.error("Production booking review status unavailable");}
    };
    const adminEmailMessage={
      from:FROM_DEFAULT,to:TO_ADMIN,subject:subjectAdmin,
      text:textAdmin,html:htmlAdmin,
      replyTo:email||undefined,attachments,
    };
    const reviewOwnerMessage=(reason,matchReason="")=>{
      // Preview 1 bookings always need ONE owner-facing outcome. When the
      // API handoff is clearly unavailable, do not claim a successful sync.
      const candidates=Array.isArray(payload.bookingScheduleSnapshot?.results)?
        payload.bookingScheduleSnapshot.results:[];
      const review=buildOwnerReviewEmail(submission.bookingId,reason,{
        customerName:name,serviceAddress:address,
        customerEmail:email,customerPhone:phone,
        requestedBinCounts:filteredBins.map(bin=>
          String(Number(bin.count)||1)+" x "+String(bin.type||"")),
        firstCleanDates:candidates.map(row=>row?.assignedCleanDate),
        bookingTotal:pricing?.total,
        matchReason,
      },{mode:isProductionHost?"production":"preview"});
      if(!review)return null;
      return {
        from:FROM_DEFAULT,to:TO_ADMIN,
        subject:review.subject,text:review.text,html:review.html,
        replyTo:email||undefined,attachments,
      };
    };
    const previewSyncUnavailable=isPreview1 && !deferAdminForPreview;
    const productionSyncUnavailable=isProductionHost && !deferAdminForProduction;
    // Resend may reject its Promise (network failure) instead of returning
    // {error}. Preserve accepted booking handling and report the failure.
    const settleEmail=promise=>Promise.resolve(promise).catch(error=>({
      error:{message:"email_provider_unavailable"},
    }));
    const adminEmailPromise=deferAdminForAuto?
      Promise.resolve({error:null,deferred:true}):
      settleEmail(resend.emails.send(productionSyncUnavailable?
        reviewOwnerMessage("automatic_sync_not_enabled")||adminEmailMessage:
        previewSyncUnavailable?
          reviewOwnerMessage(!autoDispatchConfigured(process.env)?
            "automatic_sync_not_enabled":
            "outside_approved_preview_email_pilot")||adminEmailMessage:
          adminEmailMessage));

    // The council-matched dates visible in the form belong in BOTH parts
    // of the customer receipt. This is a read-only display snapshot, not
    // authority to create a Squeegee job; the worker re-verifies separately.
    const firstCleanDates=bookingReceiptDates(payload.bookingScheduleSnapshot,{
      address,bins:filteredBins,
    });
    const firstCleanDatesText=firstCleanDates.length?
      "Your first clean date"+(firstCleanDates.length>1?"s":"")+":\n"+
      firstCleanDates.map(row=>row.bin+": "+row.date).join("\n")+
      "\n\nWe'll contact you if anything changes.":
      "We’ll be in touch shortly to confirm your cleaning schedule.";

    const customerEmailPromise = email
      ? settleEmail(resend.emails.send({
          from: FROM_DEFAULT,
          to: email,
          subject: `🗑️ Booking received — ${submission.bookingId}`,
          text: `Thanks ${name},\n\nYour Ni Bin Guy booking has been received.\n\nBooking reference: ${submission.bookingId}\n\nName: ${name}\nPhone: ${phone}\nAddress: ${address}\n\nBins:\n${binsText}\n\n${pricingBlocks.text}\n\nTerms:\nAccepted: ${termsAccepted ? "yes" : "no"}\nVersion: ${termsVersion}\nConfirmed: ${termsTimestamp}\n\n${termsPdfAttachment ? "Your signed Terms & Conditions Acceptance Certificate PDF is attached to this email.\n\n" : ""}${firstCleanDatesText}`,
          html: buildBookingEmailHtml({
            bookingId: submission.bookingId,
            name,
            address,
            phone,
            bins: filteredBins,
            pricing,
            discountCode,
            termsVersion,
            termsTimestamp,
            termsPdfAttached: Boolean(termsPdfAttachment),
            firstCleanDates,
          }),
          replyTo: TO_ADMIN,
          attachments,
        }))
      : Promise.resolve({ error: null });

    // Audit and customer receipt are still sent immediately in Preview 1.
    // Its owner email is delayed until the signed worker chooses the result.
    const auditPromise = buildAuditPromise({
      channel: "email",
      bookingId: submission.bookingId,
      arcadeOptOut: payload.arcadeOptOut === true,
      // Explicit opt-in evidence only. Do not publish or grant until a
      // verified Squeegee customer identity is linked and withdrawal checked.
      leaderboardConsent: payload.leaderboardConsent === true,
      leaderboardConsentNotice: payload.leaderboardConsent === true
        ? "nibinguy-leaderboard-firstname-town-xp-v1" : null,
      leaderboardConsentTimestamp: payload.leaderboardConsent === true
        ? new Date().toISOString() : null,
      name,
      email,
      phone,
      address,
      bins,
      // Audit the dates presented to this customer. These are browser-supplied
      // and must be independently verified before writing a Squeegee job.
      bookingScheduleSnapshot: payload.bookingScheduleSnapshot || null,
      placeId,
      lat,
      lng,
      source,
      discountCode: discountCode || null,
      pricing: pricing || null,
      termsAccepted,
      termsVersion,
      termsAcceptanceText,
      termsTimestamp,
      termsPdfAttached: Boolean(termsPdfAttachment),
      recaptcha: {
        action: recaptchaAction,
        score: recaptcha?.data?.score ?? null,
      },
      createdAt: new Date().toISOString(),
    });

    // Preview 77: the signed Squeegee worker can be durably queued once
    // the accepted submission is claimed, its signed PDF is staged and the
    // normal audit has finished. Run that handoff in parallel with Resend
    // instead of waiting for emails, leaderboard and shadow analysis.
    // This NEVER makes a second dispatch; the final block awaits this one.
    const dispatchToApprovedWorker=()=>productionSyncEnabled?
      productionDispatch.dispatchAcceptedProductionBooking(payload,{
        channel:"email",eventHost:syncHost,ownerReceipt,
      }):
      dispatchAcceptedBooking(payload,{
        channel:"email",eventHost:syncHost,ownerReceipt,
      });
    const squeegeeDispatchTask = deferAdminForAuto
      ? Promise.resolve(auditPromise)
          .then(() => timed("squeegeeQueue",dispatchToApprovedWorker))
          .catch(() => ({queued:false,reason:"dispatch_unavailable"}))
      : null;

    const [adminResult, customerResult] = await timed("receiptsAndAudit", () => Promise.all([
      adminEmailPromise,
      customerEmailPromise,
      auditPromise,
    ]));

    if (adminResult?.error) {
      console.error("Resend admin error:", adminResult.error);
      if(isPreview1||isProductionHost) await recordAutoNoDispatch({
        reason:"owner_receipt_delivery_failed_before_squeegee_dispatch",
        ownerAlertDelivery:"not_sent",
      });
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Failed to send admin email", details: adminResult.error }),
      };
    }

    if(productionSyncUnavailable) {
      await recordAutoNoDispatch({
        reason:"automatic_sync_not_enabled",
        ownerAlertDelivery:"sent",
      });
    }

    // An accepted Preview 1 booking has an immutable receipt before dispatch
    // and an audited submission; its owner email is deferred, NOT lost.
    // Elsewhere the successful admin email retains the existing acceptance
    // behaviour. Customer-email failure must not prompt duplicate retries.
    if (customerResult?.error) {
      console.error("Resend customer error:", customerResult.error);
    }

    // A customer is added to the global rankings automatically after the
    // booking email has been accepted, without a second form or another tap.
    // Prize contact information is kept in the private preview store.
    let arcadeEntry = null;
    let arcadeDeadline;
    try {
      // The booking email has already succeeded. Never hold its response
      // hostage to slow leaderboard storage or snapshot rebuilding.
      arcadeEntry = await timed("leaderboard", () => Promise.race([
        autoEnrollBooking(payload),
        new Promise((resolve) => {
          arcadeDeadline = setTimeout(() => resolve({ registered: false }), 1800);
        }),
      ]));
    } catch (error) {
      // An accepted booking must never fail because global XP is unavailable.
      // The browser will automatically retry with its signed booking proof.
      console.warn("Arcade auto-enrolment temporarily unavailable:", error?.message || "unknown");
    } finally {
      clearTimeout(arcadeDeadline);
    }

    // Shadow-mode Squeegee integration: read-only preparation after an
    // accepted booking. It must not change email, XP or confirmation results.
    try {
      await timed("readOnlyStage", () =>
        stageWithoutBlockingBooking(payload, { channel: "email" }));
    } catch (_) {
      console.warn("Read-only Squeegee booking preparation unavailable");
    }

    // Preview 1 only: dispatch AFTER customer confirmation, independent
    // audit and leaderboard. Signed receipt includes the normal admin email
    // so the worker can send it ONLY when the Squeegee import succeeds.
    const freshPilot=name===PILOT_NAME && isPreview1;
    // EVERY Preview 1 booking must show whether its Squeegee dispatch
    // was accepted. The receipt alone does not imply a job was created.
    let squeegeePilot=null;
    let deferredDispatchAccepted=false;
    let dispatchFailureReason="dispatch_unavailable";
    try {
      const handoffStarted=Date.now();
      const dispatched=squeegeeDispatchTask
        ? await squeegeeDispatchTask
        : isProductionHost?
          {queued:false,reason:"automatic_sync_not_enabled"}:
          await dispatchAcceptedBooking(payload,{
            channel:"email",eventHost:syncHost,
            ownerReceipt:deferAdminForAuto?ownerReceipt:null,
          });
      if(!squeegeeDispatchTask)
        timings.squeegeeQueue=Date.now()-handoffStarted;
      deferredDispatchAccepted=dispatched.queued===true;
      dispatchFailureReason=dispatched.reason||"dispatch_unavailable";
      if(isPreview1) {
        squeegeePilot={
          queued:dispatched.queued===true,
          reason:dispatched.reason,
        };
        // No customer contact information is emitted in this diagnostic.
        console.info(freshPilot?
          "Preview 1 Fresh Sync dispatch":"Preview 1 Squeegee dispatch",{
          bookingId:submission.bookingId,...squeegeePilot,
        });
      }
      if(dispatched.reason==="dispatch_uncertain_reconcile") {
        console.warn("Preview 1 Squeegee dispatch uncertain; do not automatically retry");
      }
    } catch {
      if(isPreview1) squeegeePilot={queued:false,reason:"dispatch_unavailable"};
      console.warn("Preview 1 Squeegee dispatch unavailable");
    }
    if(deferAdminForAuto && !deferredDispatchAccepted) {
      // No accepted worker means no authoritative Squeegee outcome.
      // Send ONE urgent/manual-review email with full booking details,
      // never a normal "import succeeded" owner email. For a timeout the
      // worker MAY have started; the email explicitly warns to check first.
      let fallbackOwnerDelivery="not_sent";
      try{
        const uncertain=dispatchFailureReason==="dispatch_uncertain_reconcile" ||
          dispatchFailureReason==="dispatch_not_accepted";
        const problem=uncertain?dispatchFailureReason:
          (dispatchFailureReason==="not_enabled"?
            "automatic_sync_not_enabled":
            "dispatch_unavailable");
        const fallbackMessage=reviewOwnerMessage(problem,dispatchFailureReason);
        const fallback=await timed("ownerReviewFallback", () =>
          resend.emails.send(fallbackMessage||adminEmailMessage));
        if(fallback?.error)
          console.error("Preview 1 owner review email fallback failed",fallback.error);
        else {
          fallbackOwnerDelivery="sent";
          console.info("Preview 1 owner manual review email sent after Squeegee handoff failed",{
            bookingId:submission.bookingId,
          });
        }
      }catch{
        console.error("Preview 1 owner review email fallback delivery exception");
      }
      // The owner-only status page must still show the booking when the
      // Resend review email failed or the worker handoff never succeeded.
      // onlyIfNew prevents an uncertain dispatch from overwriting a worker.
      await recordAutoNoDispatch({
        reason:dispatchFailureReason,
        ownerAlertDelivery:fallbackOwnerDelivery,
      });
    }
    if(isPreview1 && !deferAdminForAuto && !deferredDispatchAccepted) {
      // The normal owner warning was sent, but Squeegee wasn't queued.
      // Retain a queryable record even when the owner missed that email.
      await recordNoDispatch(submission.bookingId,{
        reason:dispatchFailureReason,
        ownerAlertDelivery:"sent",
      });
    }

    const durationMs = Date.now() - startedAt;
    // A per-stage log allows comparison before/after caching without
    // exposing customer records, booking identifiers or proof details.
    console.info("Booking stage timings (ms)", JSON.stringify({
      total: durationMs, ...timings,
    }));
    const serverTiming = [
      `booking;dur=${durationMs}`,
      ...Object.entries(timings)
        .filter(([, ms]) => Number.isFinite(ms))
        .map(([name, ms]) => `${name};dur=${ms}`),
    ].join(", ");

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Server-Timing": serverTiming,
      },
      body: JSON.stringify({
        success: true,
        bookingId: submission.bookingId,
        submittedAt: submission.submittedAt,
        serverReceivedAt: submission.serverReceivedAt,
        customerConfirmationSent: !customerResult?.error,
        arcadeBookingProof: signBooking(payload),
        arcadeRegistered: Boolean(arcadeEntry?.registered),
        arcadePlayerToken: arcadeEntry?.playerToken || null,
        arcadeCustomerRef: arcadeEntry?.customerRef || null,
        arcadeTown: arcadeEntry?.town || null,
        // Populated for all Preview 1 website bookings only.
        // Queued means internal receipt, NOT confirmed Squeegee creation.
        squeegeePilot,
      }),
    };
  } catch (error) {
    console.error("sendBookingEmail failed:", error);
    return { statusCode: 500, body: JSON.stringify({ error: "Email send failed" }) };
  }
};