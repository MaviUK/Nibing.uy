import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import BOOKING_TERMS from "./data/bookingTerms.json";
import { useLiveCounters } from "./data/statsPlan";
import CoverageChecker from "./CoverageChecker.jsx";
import N64GameBin from "./N64GameBin.jsx";
import LevelWasher from "./components/LevelWasher.jsx";
import { CustomerReviews, CustomerQuestions } from "./components/CustomerTrustSections.jsx";
import BookingAddressAutocomplete, { findNiPostcode } from "./components/BookingAddressAutocomplete.jsx";
import { createFriendlyBookingReference } from "./bookingReference.mjs";
import { validateArcadeBookingFields, bookingFieldTarget, matchedBookingDatePreview } from "./bookingFormValidation.mjs";

const TenSecondChallenge = lazy(() => import("./TenSecondChallenge.jsx"));
const BinCheckerModal = lazy(() => import("./BinCheckerModal.jsx"));

/**
 * Ni Bin Guy — Landing Page
 * - Single Submit Booking action (automated email confirmation + preview sync)
 * - ToS gating + modal (Confirm & Agree)
 * - Google Places Autocomplete
 * - 10-Second Challenge modal
 *
 * UPDATED:
 * - Discount code field
 * - Discount validation (client-side)
 * - Discounted prices shown in dropdown
 * - Total + breakdown included in WhatsApp + Email payload/message
 *
 * UPDATED (reCAPTCHA v3):
 * - Dynamically inject reCAPTCHA v3 script on this page
 * - Include recaptchaToken + action in booking email + contact email payloads
 */

/* ────────────────────────────────────────────────────────────────────────────
   Constants & Utilities
   ──────────────────────────────────────────────────────────────────────────── */
const PHONE_E164 = "+447555178484";
const PHONE_DISPLAY = "07555 178484";

const TERMS_VERSION = BOOKING_TERMS.version;
const TERMS_TITLE = BOOKING_TERMS.title;
const TERMS_BODY = BOOKING_TERMS.body;

/* ────────────────────────────────────────────────────────────────────────────
   reCAPTCHA v3 (dynamic inject + token helper)
   ──────────────────────────────────────────────────────────────────────────── */
function loadRecaptchaV3(siteKey) {
  return new Promise((resolve, reject) => {
    if (!siteKey) return reject(new Error("Missing VITE_RECAPTCHA_SITE_KEY"));

    // already available
    if (window.grecaptcha?.execute) return resolve(window.grecaptcha);

    // script already injected
    const existing = document.getElementById("recaptcha-script");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.grecaptcha));
      existing.addEventListener("error", reject);
      return;
    }

    const script = document.createElement("script");
    script.id = "recaptcha-script";
    script.src = `https://www.google.com/recaptcha/api.js?render=${siteKey}`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.grecaptcha);
    script.onerror = reject;

    document.head.appendChild(script);
  });
}

async function getRecaptchaToken(action) {
  const siteKey = import.meta.env?.VITE_RECAPTCHA_SITE_KEY;

  try {
    await loadRecaptchaV3(siteKey);
  } catch (e) {
    console.warn("reCAPTCHA failed to load:", e);
    return null;
  }

  if (!window.grecaptcha?.execute) return null;

  return new Promise((resolve) => {
    // ready() is the safest way to ensure execute works
    window.grecaptcha.ready(async () => {
      try {
        const token = await window.grecaptcha.execute(siteKey, { action });
        resolve(token);
      } catch (e) {
        console.warn("reCAPTCHA execute failed:", e);
        resolve(null);
      }
    });
  });
}

/*
 * Preview 1 uses a server-signed browser work challenge, rate-limited by
 * Netlify, rather than the production-domain reCAPTCHA key. No extra customer
 * form, name field or checkbox is needed; the live website keeps reCAPTCHA.
 */
const N64_BOOKING_PREVIEW_HOST = "deploy-preview-77--nibinguy.netlify.app";

async function getPreviewBookingProof() {
  if (!window.crypto?.subtle) {
    throw new Error("Secure browser verification is unavailable");
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  let challenge;
  try {
    const response = await fetch("/.netlify/functions/previewBookingChallenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: controller.signal,
    });
    challenge = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(challenge?.error || "Unable to start preview verification");
    }
  } finally {
    window.clearTimeout(timer);
  }
  if (typeof challenge.ticket !== "string" || challenge.ticket.length > 800 ||
      challenge.difficulty !== 12) {
    throw new Error("Invalid preview security challenge");
  }

  // A small, responsive SHA-256 work check, averaging ~4,096 attempts on
  // Android. The API verifies the same work and accepts each ticket once.
  const encoder = new TextEncoder();
  for (let counter = 0; counter <= 200000; counter++) {
    const work = encoder.encode(challenge.ticket + ":" + counter);
    const digest = new Uint8Array(await window.crypto.subtle.digest("SHA-256", work));
    if (digest[0] === 0 && (digest[1] & 0xf0) === 0) {
      return { ticket: challenge.ticket, work: counter };
    }
  }
  throw new Error("Preview security check took too long");
}

/* ────────────────────────────────────────────────────────────────────────────
   Discount + Plans
   ──────────────────────────────────────────────────────────────────────────── */

// Your frequency dropdown options — now structured (id, label, price)
const PLANS = [
  { id: "domestic_4w", label: "4 Weekly", price: 5 },
  { id: "domestic_oneoff", label: "One-off", price: 15 },

  { id: "comm_lt360_4w", label: "Commercial <360L 4 Weekly", price: 5 },
  { id: "comm_lt360_oneoff", label: "Commercial <360L One-Off", price: 15 },

  { id: "comm_gt660_4w", label: "Commercial 660L+ 4 Weekly", price: 15 },
  { id: "comm_gt660_oneoff", label: "Commercial 660L+ One-Off", price: 45 },
];

// Discount rules (edit these whenever you want)
const DISCOUNT_CODES = {
  FRESH20: {
    type: "percent",
    value: 20,
    appliesTo: ["domestic_4w"],
    expiresAt: "2026-07-31T23:59:59Z", // expiry (UTC)
    // startsAt: "2025-12-01T00:00:00Z", // optional
  },
};

function normalizeCode(code) {
  return (code || "").trim().toUpperCase();
}

function money(n) {
  const x = Math.round((Number(n) || 0) * 100) / 100;
  return x % 1 === 0 ? `${x.toFixed(0)}` : `${x.toFixed(2)}`;
}

function getPlanById(id) {
  return PLANS.find((p) => p.id === id) || null;
}

function computeDiscountedUnitPrice(basePrice, planId, code) {
  const c = normalizeCode(code);
  if (!c) return { unitPrice: basePrice, discounted: false, reason: null };

  const rule = DISCOUNT_CODES[c];
  if (!rule) return { unitPrice: basePrice, discounted: false, reason: "Invalid code" };

  const now = Date.now();
  if (rule.startsAt && now < Date.parse(rule.startsAt)) {
    return { unitPrice: basePrice, discounted: false, reason: "Code not active yet" };
  }
  if (rule.expiresAt && now > Date.parse(rule.expiresAt)) {
    return { unitPrice: basePrice, discounted: false, reason: "Code expired" };
  }

  if (!rule.appliesTo.includes(planId)) {
    return { unitPrice: basePrice, discounted: false, reason: "Code not valid for this clean" };
  }

  if (rule.type === "percent") {
    const unitPrice = Math.max(0, Math.round(basePrice * (1 - rule.value / 100) * 100) / 100);
    return { unitPrice, discounted: true, reason: null };
  }

  if (rule.type === "fixed") {
    const unitPrice = Math.max(0, Math.round((basePrice - rule.value) * 100) / 100);
    return { unitPrice, discounted: true, reason: null };
  }

  if (rule.type === "free") {
    return { unitPrice: 0, discounted: true, reason: null };
  }

  return { unitPrice: basePrice, discounted: false, reason: "Invalid code" };
}

function validateCodeAgainstSelection(bins, code) {
  const c = normalizeCode(code);
  if (!c) return { state: "empty", message: "" };

  const rule = DISCOUNT_CODES[c];
  if (!rule) return { state: "invalid", message: "That code isn’t valid." };

  const now = Date.now();
  if (rule.startsAt && now < Date.parse(rule.startsAt)) {
    return { state: "invalid", message: "That code isn’t active yet." };
  }
  if (rule.expiresAt && now > Date.parse(rule.expiresAt)) {
    return { state: "invalid", message: "That code has expired." };
  }

  const appliesToAtLeastOne = bins.some((b) => !!b.planId && rule.appliesTo.includes(b.planId));
  if (!appliesToAtLeastOne) {
    return { state: "invalid", message: "That code doesn’t apply to your selected clean(s)." };
  }

  return { state: "valid", message: "Discount code applied ✅" };
}

/* ────────────────────────────────────────────────────────────────────────────
   Generic UI (Modal shell)
   ──────────────────────────────────────────────────────────────────────────── */
function Modal({ open, onClose, children, maxWidth = "max-w-md", labelledBy, dark = false }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 bg-black/80 overflow-y-auto overscroll-contain z-50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="min-h-[100svh] flex justify-center items-center p-4">
        <div
          className={`${dark ? "bg-zinc-900 text-white border border-zinc-700" : "bg-white text-black"} rounded-xl shadow-xl w-11/12 ${maxWidth} overflow-auto relative`}
          onClick={(e) => e.stopPropagation()}
          style={{ maxHeight: "min(90dvh, 820px)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Terms Modal
   ──────────────────────────────────────────────────────────────────────────── */
function TermsModal({ open, onClose, onConfirm, version, title, body }) {
  const scrollRef = useRef(null);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Reopening the agreement must never reuse a prior scrolled-to-end state.
    setScrolledToEnd(false);
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
    const onScroll = () => {
      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
      if (atEnd) setScrolledToEnd(true);
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-black/70" onClick={onClose}>
      <div className="min-h-[100svh] flex items-center justify-center p-3 sm:p-6">
        <div
          className="bg-white text-black w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="tos-title"
        >
          <div className="px-6 py-4 border-b flex items-center justify-between">
            <h2 id="tos-title" className="text-lg font-bold">
              {title} <span className="text-xs font-normal text-gray-500">(v{version})</span>
            </h2>
            <button onClick={onClose} className="text-2xl leading-none text-gray-500 hover:text-black" aria-label="Close Terms">
              &times;
            </button>
          </div>
          <div ref={scrollRef} className="px-6 py-4 max-h-[70dvh] overflow-y-auto whitespace-pre-line text-sm leading-6">
            {body}
          </div>
          <div className="px-6 py-4 border-t bg-gray-50 flex items-center justify-between gap-3">
            <div className="text-xs text-gray-600">Scroll to the end to enable agreement.</div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-neutral-200 hover:bg-neutral-300">
                Close
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={!scrolledToEnd}
                className="px-4 py-2 rounded-lg bg-green-500 hover:bg-green-600 text-black font-semibold disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-400"
                aria-disabled={!scrolledToEnd}
              >
                Confirm &amp; Agree
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Booking Form
   ──────────────────────────────────────────────────────────────────────────── */
function createBookingSubmissionMeta() {
  const now = new Date();
  return {
    bookingId: createFriendlyBookingReference(),
    submittedAt: now.toISOString(),
  };
}

const DEFAULT_BIN = { type: "", count: 1, planId: "domestic_4w", sizeLitres: null };

function isLargeCommercialPlan(planId) {
  return planId === "comm_gt660_4w" || planId === "comm_gt660_oneoff";
}
function hasRequiredBinSize(bin) {
  return !isLargeCommercialPlan(bin?.planId) ||
    bin.sizeLitres === 660 || bin.sizeLitres === 1100;
}

function normaliseBookingContactNumber(input) {
  const compact = String(input || "").trim().replace(/[\s().-]/g, "");
  if (/^0[1-9]\d{9}$/.test(compact)) return compact;
  if (/^\+44[1-9]\d{9}$/.test(compact)) return "0" + compact.slice(3);
  if (/^0044[1-9]\d{9}$/.test(compact)) return "0" + compact.slice(4);
  return null;
}

function BookingForm({ onClose, initialAddress = "" }) {
  const [bins, setBins] = useState([DEFAULT_BIN]);
  const [address, setAddress] = useState(initialAddress);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [placeId, setPlaceId] = useState(null);
  const [manualPostcode, setManualPostcode] = useState("");

  // Discount state
  const [discountCode, setDiscountCode] = useState("");
  const [discountStatus, setDiscountStatus] = useState({ state: "empty", message: "" });

  const selectedPlaceRef = useRef(null);

  // Terms gating state
  const [showTerms, setShowTerms] = useState(false);
  const [termsConfirmed, setTermsConfirmed] = useState(false);
  const [agreeToTerms, setAgreeToTerms] = useState(false);
  // Lock immediately on the first tap, before schedule/CAPTCHA/email awaits.
  // Keep the same random booking reference for this attempt to avoid duplicates.
  const [isEmailSubmitting, setIsEmailSubmitting] = useState(false);
  const [emailSendingStage, setEmailSendingStage] = useState("checking");
  const [emailBookingError, setEmailBookingError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [emailBookingUncertain, setEmailBookingUncertain] = useState(false);
  const emailSubmissionInFlightRef = useRef(false);
  const emailSubmissionRef = useRef(null);
  const [bookingStatus, setBookingStatus] = useState("idle");
  const [bookingConfirmation, setBookingConfirmation] = useState(null);
  const [referenceCopied, setReferenceCopied] = useState("idle");
  // Preview 1: leaderboard disclosure will move into the Terms of Service.
  // Do not add a second form or leaderboard checkbox to booking.
  const arcadeOptOut = false;


  const canToggleAgree = termsConfirmed;
  const addSelectedPostcode = () => {
    const postcode=findNiPostcode(manualPostcode);
    if (!postcode) return;
    setAddress(current => {
      const base=String(current||"").trim()
        .replace(/,\s*(?:UK|United Kingdom)\s*$/i,"")
        .replace(/,\s*$/,"");
      return base ? base+", "+postcode : postcode;
    });
    setManualPostcode("");
    setPlaceId(null); // Street-only Google location isn't a verified house.
    selectedPlaceRef.current=null;
    clearFieldError("address");
  };
  const clearFieldError = (key) => setFieldErrors((current) => {
    if (!current[key]) return current;
    const copy = { ...current };
    delete copy[key];
    return copy;
  });
  const renderFieldError = (key) => fieldErrors[key] ? (
    <p id={"booking-error-" + key} className="mt-1 text-sm font-bold text-red-800" role="alert">
      {fieldErrors[key]}
    </p>
  ) : null;

  // Re-validate discount whenever selection changes
  useEffect(() => {
    setDiscountStatus(validateCodeAgainstSelection(bins, discountCode));
  }, [bins, discountCode]);

  useEffect(() => {
    const panel = document.querySelector("[data-auto-schedule-panel]");
    if (!panel) return;
    panel.style.display = bookingStatus === "idle" ? "" : "none";
    return () => {
      panel.style.display = "";
    };
  }, [bookingStatus]);


  const missingFields = useMemo(() => !name || !email || !address || !phone ||
    bins.some((b) => !b.type || !hasRequiredBinSize(b)), [name, email, address, phone, bins]);

  const TOS_PREFIX = useMemo(() => `I confirm I’ve read and agree to the Ni Bin Guy Terms of Service (v${TERMS_VERSION}), including the optional leaderboard acknowledgement`, []);

  const addBinRow = () => setBins((prev) => [...prev, { ...DEFAULT_BIN }]);
  const removeLastBin = () => setBins((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));

  const handleBinChange = (index, field, value) => {
    clearFieldError("binType" + index);
    clearFieldError("binCount" + index);
    clearFieldError("binSize" + index);
    setBins((prev) => {
      const next = [...prev];
      const updated = {
        ...next[index],
        [field]: field === "count" ? parseInt(value || 0, 10) :
          field === "sizeLitres" ? (value ? Number(value) : null) : value,
      };
      if (field === "planId" && !isLargeCommercialPlan(value)) {
        updated.sizeLitres = null;
      }
      next[index] = updated;
      return next;
    });
  };

  // Pricing breakdown. Every complete group of 7 bins gets 1 bin free automatically.
  // With mixed prices/plans, the cheapest billable bin in each group is the free one.
  const pricing = useMemo(() => {
    const baseLines = bins
      .filter((b) => b.type)
      .map((b, idx) => {
        const plan = getPlanById(b.planId);
        const baseUnit = plan?.price ?? 0;
        const planLabel = (plan?.label ?? "Unknown") +
          (isLargeCommercialPlan(b.planId) && b.sizeLitres ? ` — ${b.sizeLitres}L` : "");
        const { unitPrice, discounted } = computeDiscountedUnitPrice(baseUnit, b.planId, discountCode);

        const qty = Math.max(1, Number(b.count) || 1);
        const lineTotal = Math.round(unitPrice * qty * 100) / 100;

        return {
          idx,
          type: b.type,
          count: qty,
          planId: b.planId,
          sizeLitres: isLargeCommercialPlan(b.planId) ? b.sizeLitres : null,
          planLabel,
          baseUnit,
          unitPrice,
          discounted,
          freeCount: 0,
          multiBuyDiscount: 0,
          lineTotal,
        };
      });

    const subtotal = baseLines.reduce((acc, l) => acc + l.baseUnit * l.count, 0);
    const totalBinCount = baseLines.reduce((acc, l) => acc + l.count, 0);
    let freeBinsRemaining = Math.floor(totalBinCount / 7);

    const lines = baseLines.map((line) => ({ ...line }));
    const cheapestFirst = lines
      .map((line, lineIndex) => ({ lineIndex, unitPrice: line.unitPrice }))
      .filter((entry) => entry.unitPrice > 0)
      .sort((a, b) => a.unitPrice - b.unitPrice || a.lineIndex - b.lineIndex);

    for (const { lineIndex } of cheapestFirst) {
      if (freeBinsRemaining <= 0) break;
      const line = lines[lineIndex];
      const freeCount = Math.min(line.count, freeBinsRemaining);
      if (freeCount <= 0) continue;

      const multiBuyDiscount = Math.round(line.unitPrice * freeCount * 100) / 100;
      line.freeCount = freeCount;
      line.multiBuyDiscount = multiBuyDiscount;
      line.lineTotal = Math.max(0, Math.round((line.lineTotal - multiBuyDiscount) * 100) / 100);
      line.planLabel = `${line.planLabel} — 7 for 6 offer (${freeCount} free)`;
      freeBinsRemaining -= freeCount;
    }

    const total = lines.reduce((acc, l) => acc + l.lineTotal, 0);
    const multiBuyFreeBins = lines.reduce((acc, l) => acc + l.freeCount, 0);
    const multiBuyDiscount = lines.reduce((acc, l) => acc + l.multiBuyDiscount, 0);

    return {
      lines,
      subtotal: Math.round(subtotal * 100) / 100,
      total: Math.round(total * 100) / 100,
      multiBuyFreeBins,
      multiBuyDiscount: Math.round(multiBuyDiscount * 100) / 100,
    };
  }, [bins, discountCode]);

  const handleSubmitBooking = async () => {
    // A React state update is not synchronous; the ref blocks a second tap
    // even before the disabled button has had time to render.
    if (emailSubmissionInFlightRef.current || emailBookingUncertain ||
        bookingStatus !== "idle") return;

    const validContactNumber=normaliseBookingContactNumber(phone);
    const errors=validateArcadeBookingFields({
      name,email,phone,address,bins,
      hasNiPostcode:Boolean(findNiPostcode(address)),
      validPhone:Boolean(validContactNumber),
      discountCode,discountValid:discountStatus.state==="valid",
      termsConfirmed,agreeToTerms,
    });
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      const target=bookingFieldTarget(Object.keys(errors)[0]);
      window.requestAnimationFrame(() => {
        const field=document.getElementById(target);
        field?.focus?.();
        field?.scrollIntoView?.({ behavior:"smooth",block:"center" });
      });
      return;
    }
    setFieldErrors({});

    // Preserve one reference for this booking. If the request reaches Netlify
    // twice, the server's replay guard rejects the second delivery.
    let emailSubmissionMeta;
    try {
      emailSubmissionMeta = emailSubmissionRef.current || createBookingSubmissionMeta();
    } catch {
      setEmailBookingError(
        "Couldn't create a secure booking reference. Please refresh and try again."
      );
      return;
    }
    emailSubmissionInFlightRef.current = true;
    emailSubmissionRef.current = emailSubmissionMeta;
    setIsEmailSubmitting(true);
    setEmailSendingStage("checking");
    setEmailBookingError("");
    let safeToRetry = false;
    let requestTimer = null;

    try {
      // Begin the preview security proof while the independent council
      // calendar is still loading. Both complete before any booking POST.
      // Catch promptly so an early security failure never becomes unhandled.
      const recaptchaAction = "booking_submit";
      const previewHost = window.location.hostname === N64_BOOKING_PREVIEW_HOST;
      const securityWork = (previewHost
        ? getPreviewBookingProof().then(previewProof => ({ previewProof }))
        : getRecaptchaToken(recaptchaAction).then(recaptchaToken => ({ recaptchaToken }))
      ).then(value => ({ value }), error => ({ error }));

      // The booking schedule is informative and must not leave a customer
      // staring at an unresponsive Send button if its lookup hangs.
      if (typeof window.nbgEnsureBookingSchedule === "function") {
        try {
          // Preview 1 must allow the slow council calendar to finish.
          // Production retains the existing short non-blocking deadline.
          const previewScheduleWait=window.location.hostname===N64_BOOKING_PREVIEW_HOST
            ? 22000 : 5500;
          await Promise.race([
            Promise.resolve().then(() => window.nbgEnsureBookingSchedule()),
            new Promise((resolve) => window.setTimeout(resolve, previewScheduleWait)),
          ]);
        } catch (_) {
          console.warn("Booking schedule unavailable; date will be confirmed separately.");
        }
      }

      setEmailSendingStage("verifying");
      const verified = await securityWork;
      if (verified.error) throw verified.error;
      const previewProof = verified.value.previewProof || null;
      const recaptchaToken = verified.value.recaptchaToken || null;
      if (!previewHost && !recaptchaToken) throw new Error("security_not_ready");

      const loc = selectedPlaceRef.current?.geometry?.location;
      const lat = loc ? loc.lat() : null;
      const lng = loc ? loc.lng() : null;

      setEmailSendingStage("sending");
      const requestController = new AbortController();
      requestTimer = window.setTimeout(() => requestController.abort(), 45000);
      // The existing confirmation endpoint sends customer/owner emails and
      // securely dispatches the accepted booking to Preview 1 Squeegee sync.
      // Customers need only tap Submit Booking; never trigger a second POST.
      const emailBookingPayload = {
          ...emailSubmissionMeta,
          name,
          email,
          phone: validContactNumber,
          address,
          bins,
          // Client-side snapshot only; future job creation must verify it.
          bookingScheduleSnapshot: window.nbgGetBookingScheduleSnapshot?.() || null,
          arcadeClaimed: window.n64Score?.activityKeys?.() || [],
          arcadeOptOut,
          placeId,
          lat,
          lng,
          discountCode: normalizeCode(discountCode) || null,
          pricing,
          termsAccepted: true,
          termsVersion: TERMS_VERSION,
          termsAcceptanceText: TOS_PREFIX,
          recaptchaToken,
          previewProof,
          recaptchaAction,
      };
      const res = await fetch("/.netlify/functions/sendBookingEmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: requestController.signal,
        body: JSON.stringify(emailBookingPayload),
      });

      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        // These failures are rejected before any email send, so it's safe
        // to create a new security ticket and let the visitor try again.
        safeToRetry = [400, 401, 403, 422, 424, 428, 429].includes(res.status) ||
          (res.status === 503 && result?.reason === "booking_guard_not_ready" && result?.safeToRetry === true);
        if (res.status === 424) emailSubmissionRef.current = null;
        const message = res.status === 503 && result?.reason === "booking_guard_not_ready"
          ? "Booking security is temporarily unavailable. Nothing was submitted; please try again shortly."
          : res.status === 503 && result?.reason === "booking_reservation_uncertain"
          ? "Your booking may already be recorded. Do not book again; contact NI Bin Guy with your booking reference."
          : res.status === 424
          ? "The Terms PDF could not be prepared. Nothing was submitted; please try again."
          : res.status === 428
            ? "Our Terms of Service have been updated. Refresh the page, review them and try again."
          : res.status === 403
          ? "The booking security check was not accepted. Nothing was sent; please try again."
          : res.status === 429
            ? "Too many booking attempts. Please leave a little time before trying again."
            : res.status === 409
              ? "This booking reference was already submitted. Check your confirmation email before trying again."
              : safeToRetry
                ? "Your booking wasn't submitted. Please check the details and try again."
                : "We couldn't confirm the booking. Please check your email before trying again, to avoid a duplicate.";
        setEmailBookingError(message);
        if (!safeToRetry) setEmailBookingUncertain(true);
        return;
      }

      // One accepted booking ID earns leaderboard points once. The server
      // manages Squeegee delivery independently; do not call the retired
      // supervised one-booking endpoint from the customer-facing form.
      try {
        window.n64Score?.awardBooking(emailSubmissionMeta.bookingId, bins);
        window.n64Score?.onBookingConfirmed(result, arcadeOptOut, emailSubmissionMeta.bookingId);
      } catch (scoreError) {
        console.warn("Arcade score sync deferred; booking succeeded:", scoreError);
      }
      setBookingConfirmation({
        ...result,
        bookingId: result.bookingId || emailSubmissionMeta.bookingId,
        source: "website",
        // Show the actual council-matched date displayed in the form.
        // The asynchronous Squeegee job is NOT confirmed by this preview.
        datePreview: matchedBookingDatePreview(
          emailBookingPayload.bookingScheduleSnapshot,{address,bins}),
      });
      setBookingStatus("confirmed");
      // Intentionally keep the submission ref locked after a successful send.
    } catch (error) {
      console.warn("Booking email request was not completed:", error?.name || "unknown");
      if (error?.message === "security_not_ready" ||
          /preview security|security challenge|security check|security verification/i.test(error?.message || "")) {
        safeToRetry = true;
        setEmailBookingError("The security check could not be completed. No email was sent; please try again.");
      } else {
        setEmailBookingUncertain(true);
        setEmailBookingError(
          "We couldn't confirm whether the email was sent. Check your inbox before booking again, or contact NI Bin Guy."
        );
      }
    } finally {
      if (requestTimer) window.clearTimeout(requestTimer);
      setIsEmailSubmitting(false);
      if (safeToRetry) emailSubmissionInFlightRef.current = false;
    }
  };

  const bookingSendingText = emailSendingStage === "sending"
    ? "Submitting your booking…"
    : emailSendingStage === "verifying"
      ? "Verifying your booking…"
      : "Preparing your booking…";

  if (bookingStatus === "confirmed") {
    const scheduleResults = Array.isArray(bookingConfirmation?.datePreview?.results)
      ? bookingConfirmation.datePreview.results
      : [];

    const cleanDateRows = scheduleResults
      .filter((result) => result?.assignedCleanDate)
      .map((result) => {
        const date = new Date(`${result.assignedCleanDate}T12:00:00`);
        const formatted = Number.isNaN(date.getTime())
          ? result.assignedCleanDate
          : date.toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            });
        return {
          bin: String(result?.bin || "Bin").replace(/\s+Bin$/i, ""),
          date: formatted,
        };
      });

    return (
      <div className="p-7 text-center space-y-5">
        <div className="mx-auto w-16 h-16 rounded-full bg-green-500 text-white flex items-center justify-center text-3xl font-black">
          ✓
        </div>

        <div>
          <h2 className="text-2xl font-extrabold text-gray-900">
            {bookingConfirmation?.squeegeePilot ? "Booking received" : "Booking confirmed"}
          </h2>
          <p className="mt-2 text-gray-600">
            {bookingConfirmation?.customerConfirmationSent === false ? (
              <>Your booking has been received, but the confirmation email could not be delivered to <strong>{email}</strong>. Please contact us so we can resend it.</>
            ) : (
              <>Your booking has been received and the confirmation has been emailed to <strong>{email}</strong>.</>
            )}
          </p>
          {bookingConfirmation?.bookingId && (
            <div className="mt-4 border-2 border-[#20345c] bg-[#fff4c2] p-4">
              <p className="text-xs font-black uppercase tracking-wider text-[#20345c]">
                Booking reference:
              </p>
              <p className="mt-2 break-all font-mono text-lg font-black tracking-wide text-[#20345c]">
                {bookingConfirmation.bookingId}
              </p>
              <button
                type="button"
                aria-label="Copy booking reference"
                className="mt-3 w-full border-2 border-[#20345c] bg-[#20345c] px-3 py-2 text-sm font-extrabold text-white"
                onClick={async () => {
                  try {
                    await window.navigator.clipboard.writeText(bookingConfirmation.bookingId);
                    setReferenceCopied("copied");
                  } catch {
                    setReferenceCopied("unavailable");
                  }
                }}
              >
                {referenceCopied === "copied" ? "Copied ✓" : "Copy reference"}
              </button>
              {referenceCopied === "unavailable" && (
                <p className="mt-2 text-xs text-[#20345c]">
                  Long-press the reference above to copy it.
                </p>
              )}
            </div>
          )}
        </div>

        {cleanDateRows.length > 0 ? (
          <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-left">
            <div className="text-sm font-bold uppercase tracking-wide text-green-800">Your first clean date{cleanDateRows.length > 1 ? "s" : ""}</div>
            <div className="mt-2 space-y-2">
              {cleanDateRows.map((row, index) => (
                <div key={`${row.bin}-${row.date}-${index}`} className="flex items-start justify-between gap-4">
                  <span className="font-semibold text-gray-800">{row.bin}</span>
                  <span className="text-right font-bold text-gray-900">{row.date}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            We've received your booking. We'll email your first clean date shortly. Please don't submit another booking for the same bins.
          </div>
        )}

        <button onClick={onClose} className="w-full rounded-none bg-neutral-900 px-5 py-3 font-bold text-white hover:bg-neutral-800">
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4" aria-busy={isEmailSubmitting}>
      {isEmailSubmitting && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0d1932]/80 p-4"
          role="status" aria-live="polite" aria-label={bookingSendingText}
        >
          <div className="w-full max-w-sm border-4 border-[#20345c] bg-[#fff8df] px-5 py-7 text-center text-[#20345c] shadow-[7px_8px_0_#6e8ea9]">
            <span className="mx-auto mb-5 block h-14 w-14 animate-spin rounded-full border-[7px] border-[#20345c] border-t-[#ffda43]" aria-hidden="true" />
            <strong className="block text-xl font-black">{bookingSendingText}</strong>
            <p className="mt-3 text-sm font-semibold leading-relaxed">
              Please keep this page open. Your booking is being processed and only needs to be submitted once.
            </p>
          </div>
        </div>
      )}
      <button onClick={onClose} className="absolute top-3 right-4 text-gray-500 hover:text-red-500 text-2xl z-10" aria-label="Close booking">
        &times;
      </button>

      <h2 id="booking-title" className="text-2xl font-bold text-center">
        Book a Bin Clean
      </h2>

      {Object.keys(fieldErrors).length > 0 && (
        <div id="booking-form-error-summary" className="border-2 border-red-800 bg-red-50 p-3 text-sm font-bold text-red-900" role="alert">
          Please check the highlighted booking details below. Your entries have been kept.
        </div>
      )}
      <label htmlFor="booking-customer-name" className="sr-only">Your name</label>
      <input id="booking-customer-name" type="text" placeholder="Your Name" autoComplete="name"
        value={name} onChange={(e) => { setName(e.target.value); clearFieldError("name"); }}
        aria-invalid={Boolean(fieldErrors.name)}
        aria-describedby={fieldErrors.name ? "booking-error-name" : undefined}
        className="w-full border border-gray-500 rounded-none px-4 py-2" />
      {renderFieldError("name")}

      {bins.map((bin, index) => {
        return (
          <div key={index} className="space-y-2 border-b border-gray-200 pb-4 mb-4">
            <div className="flex gap-4">
              <select id={`booking-bin-type-${index}`} aria-label={`Bin colour ${index+1}`}
                aria-invalid={Boolean(fieldErrors["binType"+index])}
                value={bin.type} onChange={(e) => handleBinChange(index, "type", e.target.value)}
                className="w-2/3 border border-gray-500 rounded-none px-4 py-2">
                <option value="">Select Bin</option>
                <option value="Black Bin">Black</option>
                <option value="Brown Bin">Brown</option>
                <option value="Green Bin">Green</option>
                <option value="Blue Bin">Blue</option>
              </select>

              <input id={`booking-bin-count-${index}`} type="number" min="1" max="200"
                aria-label={`Quantity for bin ${index+1}`}
                aria-invalid={Boolean(fieldErrors["binCount"+index])}
                value={bin.count} onChange={(e) => handleBinChange(index, "count", e.target.value)}
                className="w-1/3 border border-gray-500 rounded-none px-4 py-2" />
            </div>
            {renderFieldError("binType"+index)}
            {renderFieldError("binCount"+index)}

            <select value={bin.planId} onChange={(e) => handleBinChange(index, "planId", e.target.value)} className="w-full border border-gray-500 rounded-lg px-4 py-2">
              {PLANS.map((p) => {
                const { unitPrice, discounted } = computeDiscountedUnitPrice(p.price, p.id, discountCode);
                const label = `${p.label} (£${money(unitPrice)})${discounted ? " ✓" : ""}`;
                return (
                  <option key={p.id} value={p.id}>
                    {label}
                  </option>
                );
              })}
            </select>
            {isLargeCommercialPlan(bin.planId) && (
              <div className="space-y-1">
                <label htmlFor={`large-bin-size-${index}`} className="block text-sm font-bold text-gray-800">
                  Commercial bin size (required)
                </label>
                <select
                  id={`large-bin-size-${index}`}
                  value={bin.sizeLitres ?? ""}
                  onChange={(e) => handleBinChange(index, "sizeLitres", e.target.value)}
                  required
                  aria-required="true"
                  aria-invalid={Boolean(fieldErrors["binSize"+index])}
                  className="w-full border border-gray-500 rounded-none px-4 py-2"
                >
                  <option value="">Select your bin size</option>
                  <option value="660">660 litres (660L)</option>
                  <option value="1100">1100 litres (1100L)</option>
                </select>
                {renderFieldError("binSize"+index)}
                <p className="text-xs text-gray-600">
                  Choose the bin capacity so we book the correct cleaning service.
                </p>
              </div>
            )}
          </div>
        );
      })}

      <div className="flex items-center justify-between">
        <button onClick={addBinRow} className="text-sm text-green-600 hover:text-green-800 font-semibold">
          + Add Another Bin
        </button>
        {bins.length > 1 && (
          <button onClick={removeLastBin} className="text-sm text-red-600 hover:text-red-800 font-semibold">
            − Remove Last Bin
          </button>
        )}
      </div>

      <div className="mt-2">
        <label className="block text-sm font-semibold text-gray-700 mb-1">Discount Code (optional)</label>
        <input id="booking-discount-code" type="text" placeholder="Enter code"
          value={discountCode} onChange={(e) => { setDiscountCode(e.target.value); clearFieldError("discount"); }}
          aria-invalid={Boolean(fieldErrors.discount)} className="w-full border border-gray-500 rounded-none px-4 py-2" />
        {renderFieldError("discount")}

        {discountStatus.state === "valid" && <p className="text-sm mt-2 text-green-700 font-semibold">{discountStatus.message}</p>}
        {discountStatus.state === "invalid" && <p className="text-sm mt-2 text-red-600 font-semibold">{discountStatus.message}</p>}
      </div>

      <div className="mt-2 p-3 rounded-lg border border-gray-200 bg-gray-50">
        <div className="text-sm font-semibold text-gray-800">Pricing Summary</div>
        <div className="mt-2 space-y-1 text-sm text-gray-700">
          {pricing.lines.length ? (
            pricing.lines.map((l) => (
              <div key={l.idx} className="flex items-start justify-between gap-3">
                <div className="pr-2">
                  <div className="font-medium">
                    {l.count}x {l.type.replace(" Bin", "")}
                  </div>
                  <div className="text-xs text-gray-500">
                    {l.planLabel} — £{money(l.unitPrice)} each{l.discounted ? " (discounted)" : ""}
                  </div>
                </div>
                <div className="font-bold text-gray-900">£{money(l.lineTotal)}</div>
              </div>
            ))
          ) : (
            <div className="text-gray-500">Select a bin type to see pricing.</div>
          )}

          <div className="pt-2 mt-2 border-t border-gray-200 flex items-center justify-between">
            <div className="font-semibold">Total</div>
            <div className="font-extrabold">£{money(pricing.total)}</div>
          </div>
        </div>
      </div>

      <BookingAddressAutocomplete
        invalid={Boolean(fieldErrors.address)}
        value={address}
        onChange={(nextAddress) => {
          setAddress(nextAddress);
          clearFieldError("address");
          setPlaceId(null);
          selectedPlaceRef.current = null;
        }}
        onPlace={(place) => {
          selectedPlaceRef.current = place;
          setPlaceId(place?.place_id || null);
          setAddress(place?.formatted_address || place?.name || "");
          clearFieldError("address");
        }}
      />
      {renderFieldError("address")}
      <p className="text-xs text-gray-500 -mt-2">Select an address to fill its postcode automatically, or enter your full address and BT postcode manually.</p>
      {address.trim() && !findNiPostcode(address) && (
        <div className="border-2 border-amber-700 bg-amber-50 p-3 space-y-2">
          <label htmlFor="booking-postcode-helper" className="block text-sm font-bold text-amber-950">
            Add your BT postcode
          </label>
          <p className="text-xs text-amber-950">
            Google couldn't confirm the postcode. Check your house number and street above,
            then enter your postcode here. We won't guess one.
          </p>
          <div className="flex flex-wrap gap-2">
            <input id="booking-postcode-helper" type="text" inputMode="text"
              autoComplete="postal-code" placeholder="BT20 4AA" maxLength={9}
              value={manualPostcode} onChange={(e) => setManualPostcode(e.target.value.toUpperCase())}
              className="min-w-0 flex-1 border border-amber-800 bg-white rounded-none px-3 py-2"
              aria-label="Full BT postcode"
            />
            <button type="button" onClick={addSelectedPostcode}
              disabled={!findNiPostcode(manualPostcode)}
              className="border-2 border-[#20345c] bg-[#ffda43] px-3 py-2 font-bold text-[#20345c] disabled:opacity-50">
              Add postcode
            </button>
          </div>
        </div>
      )}

      <label htmlFor="booking-contact-phone" className="sr-only">Contact number</label>
      <input id="booking-contact-phone" type="tel" placeholder="Contact Number (11 digits)" inputMode="tel"
        autoComplete="tel" maxLength={22} value={phone}
        onChange={(e) => { setPhone(e.target.value); clearFieldError("phone"); }}
        aria-invalid={Boolean(fieldErrors.phone)}
        className="w-full border border-gray-500 rounded-none px-4 py-2 mt-2" />
      {renderFieldError("phone")}
      <p className="text-xs text-gray-600">Enter an 11-digit UK phone number, including 028 landlines or 07 mobiles. A postcode cannot be used as a phone number.</p>
      <label htmlFor="booking-contact-email" className="sr-only">Email address</label>
      <input id="booking-contact-email" type="email" placeholder="Email Address" autoComplete="email"
        value={email} onChange={(e) => { setEmail(e.target.value); clearFieldError("email"); }}
        aria-invalid={Boolean(fieldErrors.email)}
        className="w-full border border-gray-500 rounded-none px-4 py-2 mt-2" />
      {renderFieldError("email")}

      <div className="mt-4 p-3 rounded-lg border border-gray-500 bg-gray-50">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-gray-700">
            You must view and agree to the{" "}
            <button
              id="booking-terms-open"
              type="button"
              onClick={() => setShowTerms(true)}
              className="underline font-semibold"
            >
              Terms of Service
            </button>{" "}
            to book.
          </div>
          <span className="text-[10px] text-gray-500">v{TERMS_VERSION}</span>
        </div>
        <div className="mt-3 flex items-start gap-2">
          <input id="agree" type="checkbox" className="mt-1" checked={agreeToTerms}
            disabled={!canToggleAgree} onChange={(e) => { setAgreeToTerms(e.target.checked); clearFieldError("terms"); }} />
          <label htmlFor="agree" className="text-sm text-gray-800">
            I’ve read and agree to the September 2026 Terms of Service, including the public leaderboard acknowledgement. This does not make my name public.
            {!canToggleAgree && <span className="block text-xs text-gray-500">(Scroll to the bottom of the Terms and select Confirm & Agree to unlock this.)</span>}
          </label>
        </div>
        {renderFieldError("terms")}
      </div>

      <button
        type="button"
        onClick={handleSubmitBooking}
        className="w-full rounded-none border-2 border-[#20345c] bg-[#ffda43] px-6 py-3 text-lg font-black text-[#101827] shadow-[4px_4px_0_#20345c] hover:bg-[#ffe573] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={!termsConfirmed || !agreeToTerms || isEmailSubmitting || bookingStatus !== "idle" || emailBookingUncertain}
        aria-disabled={!termsConfirmed || !agreeToTerms || isEmailSubmitting || bookingStatus !== "idle" || emailBookingUncertain}
      >
        {isEmailSubmitting ? bookingSendingText : "Submit Booking"}
      </button>
      <p className="text-center text-xs font-semibold text-[#20345c]">
        We'll email your booking confirmation. If your clean date needs a manual check, we'll contact you.
      </p>
      {emailBookingError && !isEmailSubmitting && (
        <div className="border-4 border-[#ad5344] bg-[#fff0db] p-3 text-sm font-semibold text-[#652c28]" role="alert">
          {emailBookingError}
        </div>
      )}

      {showTerms && (
        <TermsModal
          open={showTerms}
          onClose={() => setShowTerms(false)}
          onConfirm={() => {
            // Only the modal's scrolled-to-bottom Confirm & Agree can unlock
            // the separate checkbox. Dismissing the modal leaves it locked.
            setTermsConfirmed(true);
            setAgreeToTerms(true);
            setShowTerms(false);
          }}
          version={TERMS_VERSION}
          title={TERMS_TITLE}
          body={TERMS_BODY}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Contact Form
   ──────────────────────────────────────────────────────────────────────────── */
function ContactForm({ onClose }) {
  const [cName, setCName] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cMessage, setCMessage] = useState("");

  const [errors, setErrors] = useState({ email: "", phone: "" });

  const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());
  const isValidPhone11 = (phone) => /^[0-9]{11}$/.test(String(phone).trim());

  const resetForm = () => {
    setCName("");
    setCEmail("");
    setCPhone("");
    setCMessage("");
    setErrors({ email: "", phone: "" });
  };

  const handleCallClick = async () => {
    const isMobile = /Android|iPhone|iPad|iPod|Windows Phone|Mobi/i.test(navigator.userAgent);
    if (isMobile) {
      window.location.href = `tel:${PHONE_E164}`;
    } else {
      try {
        await navigator.clipboard.writeText(PHONE_DISPLAY);
        alert(`Phone: ${PHONE_DISPLAY}\n(The number has been copied to your clipboard.)`);
      } catch {
        alert(`Phone: ${PHONE_DISPLAY}`);
      }
    }
  };

  const missing = useMemo(() => !cName.trim() || !cEmail.trim() || !cPhone.trim() || !cMessage.trim(), [cName, cEmail, cPhone, cMessage]);

  // Live validate as they type (optional but nice)
  useEffect(() => {
    setErrors((prev) => ({
      ...prev,
      email: cEmail && !isValidEmail(cEmail) ? "Please enter a valid email address." : "",
    }));
  }, [cEmail]);

  useEffect(() => {
    setErrors((prev) => ({
      ...prev,
      phone: cPhone && !isValidPhone11(cPhone) ? "Contact number must be exactly 11 digits." : "",
    }));
  }, [cPhone]);

  const validateOrAlert = () => {
    if (missing) {
      alert("Please complete all fields before sending.");
      return false;
    }

    const nextErrors = {
      email: isValidEmail(cEmail) ? "" : "Please enter a valid email address.",
      phone: isValidPhone11(cPhone) ? "" : "Contact number must be exactly 11 digits (numbers only).",
    };

    setErrors(nextErrors);

    if (nextErrors.email || nextErrors.phone) {
      alert(nextErrors.phone || nextErrors.email);
      return false;
    }

    return true;
  };

  const handleWhatsApp = () => {
    if (!validateOrAlert()) return;

    const msg =
      `Hi, I'm ${encodeURIComponent(cName)}.` +
      `%0APhone: ${encodeURIComponent(cPhone)}` +
      `%0AEmail: ${encodeURIComponent(cEmail)}` +
      `%0A%0AMessage:%0A${encodeURIComponent(cMessage)}`;

    window.open(`https://wa.me/${PHONE_E164}?text=${msg}`, "_blank");
    onClose?.();
    resetForm();
  };

  const handleEmail = async () => {
    if (!validateOrAlert()) return;

    // This preview uses the existing signed, rate-limited challenge for
    // contact messages too. Production continues to use reCAPTCHA v3.
    const recaptchaAction = "contact_submit";
    let recaptchaToken = null;
    let previewProof = null;
    try {
      if (window.location.hostname === N64_BOOKING_PREVIEW_HOST) {
        previewProof = await getPreviewBookingProof();
      } else {
        recaptchaToken = await getRecaptchaToken(recaptchaAction);
        if (!recaptchaToken) throw new Error("Anti-bot verification unavailable");
      }
    } catch {
      alert("The security check could not be completed. No message was sent; please try again.");
      return;
    }

    try {
      const res = await fetch("/.netlify/functions/sendContactEmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cName.trim(),
          email: cEmail.trim(),
          phone: cPhone.trim(),
          message: cMessage.trim(),
          previewProof,
          recaptchaToken,
          recaptchaAction,
        }),
      });

      if (res.ok) {
        alert("Your message has been sent!");
        onClose?.();
        resetForm();
      } else {
        alert("There was a problem sending your request. Please contact us at info@nibing.uy / 07555178484");
      }
    } catch (e) {
      console.error(e);
      alert("Error sending your message.");
    }
  };

  return (
    <div className="p-6 space-y-4">
      <button
        onClick={onClose}
        className="absolute top-3 right-4 text-gray-500 hover:text-red-500 text-2xl z-10"
        aria-label="Close contact"
      >
        &times;
      </button>

      <div className="flex items-center justify-center gap-3">
        <h2 id="contact-title" className="text-2xl font-bold text-center">
          Contact Us
        </h2>
        <button
          onClick={handleCallClick}
          className="ml-2 p-2 rounded-full bg-green-100 hover:bg-green-200 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-white"
          aria-label="Call us"
          title="Call us"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-green-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 5a2 2 0 012-2h2.28a1 1 0 01.95.684l1.1 3.3a1 1 0 01-.27 1.06l-1.6 1.6a16 16 0 007.18 7.18l1.6-1.6a1 1 0 011.06-.27l3.3 1.1a1 1 0 01.684.95V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
            />
          </svg>
        </button>
      </div>

      <input
        type="text"
        placeholder="Your Name"
        value={cName}
        onChange={(e) => setCName(e.target.value)}
        className="w-full border border-gray-500 rounded-lg px-4 py-2"
      />

      <div className="space-y-1">
        <input
          type="tel"
          placeholder="Contact Number (11 digits)"
          value={cPhone}
          maxLength={11}
          inputMode="numeric"
          pattern="[0-9]{11}"
          onChange={(e) => {
            // digits only, no spaces/symbols
            const onlyDigits = e.target.value.replace(/\D/g, "").slice(0, 11);
            setCPhone(onlyDigits);
          }}
          className={`w-full border rounded-lg px-4 py-2 ${errors.phone ? "border-red-500" : "border-gray-500"}`}
        />
        {errors.phone ? <p className="text-xs text-red-600">{errors.phone}</p> : null}
      </div>

      <div className="space-y-1">
        <input
          type="email"
          placeholder="Email Address"
          value={cEmail}
          onChange={(e) => setCEmail(e.target.value)}
          className={`w-full border rounded-lg px-4 py-2 ${errors.email ? "border-red-500" : "border-gray-500"}`}
        />
        {errors.email ? <p className="text-xs text-red-600">{errors.email}</p> : null}
      </div>

      <textarea
        placeholder="Your Message"
        value={cMessage}
        onChange={(e) => setCMessage(e.target.value)}
        className="w-full border border-gray-500 rounded-lg px-4 py-2 h-28 resize-y"
      />

      <button onClick={handleWhatsApp} className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-6 rounded-lg w-full">
        Send via WhatsApp
      </button>

      <button onClick={handleEmail} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-lg w-full">
        Send via Email
      </button>

      <p className="text-center text-sm text-gray-600 mt-2">Prefer to call? Tap the phone icon.</p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Challenge Modal (wraps TenSecondChallenge)
   ──────────────────────────────────────────────────────────────────────────── */
function ChallengeModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div
      className="n64-challenge-overlay fixed inset-0 bg-black/80 overflow-y-auto overscroll-contain z-50"
      onClick={onClose}
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="challenge-title"
    >
      <div className="n64-challenge-positioner min-h-[100svh] flex items-center justify-center px-3 py-3 sm:p-6">
        <div
          className="n64-challenge-shell relative w-full max-w-[460px] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
          style={{ maxHeight: "calc(100dvh - 24px)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="n64-challenge-close"
            aria-label="Close stopwatch challenge"
          >
            &times;
          </button>
          <Suspense fallback={<p className="p-8 text-center">Loading challenge…</p>}>
            <TenSecondChallenge />
          </Suspense>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Page Sections
   ──────────────────────────────────────────────────────────────────────────── */
function Hero({ onBook, onContact, onChallenge, onBinChecker, onCoverage }) {
  const { totalBinsCleaned, todaysArea, totalMonthlyCustomers } = useLiveCounters();

  // Lifetime total adds the owner's pre-Squeegee history once to the verified backup.
  return (
    <section className="n64-hero n64-hero-layout-v2" aria-labelledby="n64-hero-title">
      <div className="n64-cloud n64-cloud--one" aria-hidden="true" />
      <div className="n64-cloud n64-cloud--two" aria-hidden="true" />
      <div className="n64-cloud n64-cloud--three" aria-hidden="true" />

      <div className="n64-hero-inner">
        <div className="n64-hero-copy">
          <div className="n64-brand">
            <img
              src="/logo.webp"
              alt="Ni Bin Guy wheelie bin cleaning service logo"
              width="64"
              height="64"
              fetchPriority="high"
              decoding="async"
            />
            <div>
              <strong>NI BIN GUY</strong>
              <small>THE COUNTY DOWN CLEANING CREW</small>
            </div>
          </div>

          <div className="n64-kicker">★ JOIN OUR 4-WEEKLY CLEANING SCHEDULE ★</div>
          <h1 id="n64-hero-title" className="n64-headline">
            BIN CLEANING<br />
            <span>LEVELLED UP.</span>
          </h1>
          <p className="n64-lead">
            Your bins deserve a power-up. Proper washing, sanitising and freshening
            right outside your home — <strong>from just £5 per bin, every four weeks</strong>.
            Serving Bangor and surrounding County Down areas.
          </p>
          <div className="n64-price-ticket" aria-label="Four-weekly cleaning from £5 per bin">
            <strong>£5</strong>
            <span>PER BIN<br />4-WEEKLY</span>
          </div>
        </div>

        <div className="n64-scene" aria-hidden="true">
          <span className="n64-star n64-star--one">★</span>
          <span className="n64-star n64-star--two">★</span>
          <span className="n64-star n64-star--three">★</span>
          <div className="n64-bin n64-bin--left">
            <N64GameBin front="#58b8ec" side="#2576ad" lid="#94e7ff" />
          </div>
          <div className="n64-bin n64-bin--centre">
            <N64GameBin front="#68cf70" side="#359359" lid="#baf198" />
          </div>
          <div className="n64-bin n64-bin--right">
            <N64GameBin front="#e49a55" side="#aa663a" lid="#ffd28b" />
          </div>
          <span className="n64-scene-label">3 BINS · 1 CLEAN MISSION</span>
        </div>
      </div>

      <div className="n64-actions">
        <button type="button" onClick={onBook} className="n64-btn n64-btn--start">
          Book a Clean
        </button>
      </div>

      <nav className="n64-extra-links" aria-label="More NI Bin Guy options">
        <button type="button" className="n64-text-link n64-link--bonus" onClick={onChallenge}>
          <span aria-hidden="true">★</span> Free Bin Clean
        </button>
        <button type="button" className="n64-text-link n64-link--contact" onClick={onContact}>Contact Us</button>
        <a className="n64-text-link n64-link--portal" href="#customer-portal-login">Customer Portal</a>
        <button type="button" className="n64-text-link n64-link--bin-day" onClick={onBinChecker}>Bin Day Checker</button>
      </nav>

      <div className="n64-scoreboard" aria-label="Our cleaning statistics">
        <div className="n64-score">
          <span className="n64-score-title">Bins Cleaned</span>
          <strong className="n64-score-value">{Number(totalBinsCleaned).toLocaleString("en-GB")}</strong>
        </div>
        <div className="n64-score">
          <span className="n64-score-title">Today's Area</span>
          <strong className="n64-score-value">{todaysArea || "County Down"}</strong>
        </div>
        <div className="n64-score">
          <span className="n64-score-title">Monthly Customers</span>
          <strong className="n64-score-value">{Number(totalMonthlyCustomers).toLocaleString("en-GB")}</strong>
        </div>
      </div>


    </section>
  );
}


function WhatWeDo() {
  return (
    <section id="what-we-do" className="relative py-16 px-6 bg-[#18181b]">
      <LevelWasher />
      <h2 className="text-3xl font-bold text-green-400 mb-8 text-center">What We Do</h2>
      <div className="grid md:grid-cols-3 gap-6 text-center">
        <div className="bg-zinc-800/70 border border-white/30 p-6 rounded-2xl shadow-lg">
          <h3 className="text-xl font-bold mb-2">Domestic Bins</h3>
          <p>We clean green, black, and blue bins right outside your home.</p>
        </div>
        <div className="bg-zinc-800/70 border border-white/30 p-6 rounded-2xl shadow-lg">
          <h3 className="text-xl font-bold mb-2">Commercial Contracts</h3>
          <p>Need regular bin cleaning? We handle your business waste too.</p>
        </div>
        <div className="bg-zinc-800/70 border border-white/30 p-6 rounded-2xl shadow-lg">
          <h3 className="text-xl font-bold mb-2">Eco-Friendly Process</h3>
          <p>We use biodegradable products and minimal water waste.</p>
        </div>
      </div>
    </section>
  );
}

function TheProcess({ onBook }) {
  return (
    <section id="the-process" className="relative py-16 px-6 bg-[#18181b] text-white">
      <LevelWasher />
      <h2 className="text-3xl font-bold text-green-400 mb-10 text-center">The Process</h2>
      <div className="grid lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
        <div className="rounded-2xl bg-zinc-800/70 border border-white/30 p-6">
          <h3 className="text-xl font-bold">The Booking Process</h3>
          <ol className="mt-6 space-y-5">
            {["Complete the quick booking form.", "We’ll reply with your price and the next clean date (right after your bin collection).", "Approve the quote to secure your spot in the schedule.", "You’ll receive an email to set up your payment method."].map(
              (text, i) => (
                <li key={i} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-green-400/50 bg-green-500/10 text-sm font-semibold text-green-300">{i + 1}</span>
                  <p>{text}</p>
                </li>
              )
            )}
          </ol>
        </div>
        <div className="rounded-2xl bg-zinc-800/70 border border-white/30 p-6">
          <h3 className="text-xl font-bold">The Cleaning Process</h3>
          <ol className="mt-6 space-y-5">
            {["We remove any leftover waste the bin crew missed.", "Thorough wash and rinse — inside and out.", "We dry the interior to prevent residue.", "Sanitise and deodorise for a fresh finish.", "Your bin is returned clean and fresh to its usual spot."].map(
              (text, i) => (
                <li key={i} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-green-400/50 bg-green-500/10 text-sm font-semibold text-green-300">{i + 1}</span>
                  <p>{text}</p>
                </li>
              )
            )}
          </ol>
        </div>
      </div>
      <div className="mt-12 text-center">
        <button type="button" onClick={onBook} className="bg-green-500 hover:bg-green-600 text-black font-bold py-3 px-6 rounded-xl shadow-lg transition">
          Book a Clean
        </button>
      </div>
    </section>
  );
}

function BinsWeClean() {
  const items = [
  { src: "/bins/120L.webp", alt: "120 litre wheelie bin", size: "120L", h: "h-32" },
  { src: "/bins/240L.webp", alt: "240 litre wheelie bin", size: "240L", h: "h-36" },
  { src: "/bins/360L.webp", alt: "360 litre commercial bin", size: "360L", h: "h-40" },
  { src: "/bins/660L.webp", alt: "660 litre commercial waste bin", size: "660L", h: "h-44" },
  { src: "/bins/1100L.webp", alt: "1100 litre commercial waste container", size: "1100L", h: "h-48" },
];
  return (
    <section id="bins-we-clean" className="relative py-16 px-6 bg-[#18181b] text-white text-center">
      <LevelWasher />
      <h2 className="text-3xl font-bold text-green-400 mb-12">The Bins We Clean</h2>
      <div className="relative z-20 flex flex-wrap justify-center items-end gap-12 md:gap-20">
        {items.map((it) => (
          <div key={it.size} className="flex flex-col items-center">
            <img src={it.src} alt={it.alt} loading="lazy" decoding="async" className={`${it.h} mb-2`} />
            <span className="text-sm">{it.size}</span>
          </div>
        ))}
      </div>
      <div className="absolute bottom-0 left-0 w-full h-24 bg-gradient-to-b from-[#18181b] to-black pointer-events-none z-10" />
    </section>
  );
}

function WhyCleanYourBin() {
  const points = [
    { icon: "/odour.webp", title: "Prevent Nasty Odours", text: "Bins can start to smell unpleasant fast. Regular cleaning eliminates those foul smells at the source." },
    { icon: "/bacteria.webp", title: "Stop Bacteria Buildup", text: "Leftover waste can attract harmful bacteria. Professional bin cleaning keeps your environment safer and more hygienic." },
    { icon: "/pests.webp", title: "Deter Insects & Vermin", text: "Flies, maggots, and rodents are drawn to dirty bins. Keep them away by keeping your bin spotless." },
    { icon: "/family.webp", title: "Protect Your Family", text: "A clean bin reduces exposure to germs and pathogens, helping keep your household healthier." },
  ];
  return (
    <section id="why-clean-your-bin" className="py-16 px-6 bg-gradient-to-b from-black via-[#0a0a0a] to-zinc-900 text-white">
      <LevelWasher />
      <h2 className="text-3xl font-bold text-green-400 mb-12 text-center">Why Clean Your Bin?</h2>
      <div className="grid md:grid-cols-2 gap-12 max-w-6xl mx-auto">
        {points.map((p) => (
          <div key={p.title} className="flex items-start gap-4">
            <img src={p.icon} alt={p.title} loading="lazy" decoding="async" width="48" height="48" className="w-12 h-12 mt-1" />
            <div>
              <h3 className="text-xl font-semibold mb-1">{p.title}</h3>
              <p className="text-gray-300">{p.text}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function WhyNiBinGuy() {
  const points = [
    { title: "Local & Trusted", text: "We’re based in Bangor and proud to serve County Down residents with care." },
    { title: "Flexible Plans", text: "Whether you want a one-off clean or recurring service, we’ve got options." },
    { title: "Affordable Pricing", text: "From just £5 per bin — clear pricing with no surprises." },
    { title: "Fully Insured", text: "We’re fully insured and compliant — so you can rest easy." },
  ];
  return (
    <section id="why-ni-bin-guy" className="py-16 px-6 bg-gradient-to-b from-zinc-900 via-[#1a1a1a] to-black text-white">
      <LevelWasher />
      <h2 className="text-3xl font-bold text-green-400 mb-8 text-center">Why Ni Bin Guy?</h2>
      <div className="grid md:grid-cols-2 gap-10 max-w-5xl mx-auto">
        {points.map((p) => (
          <div key={p.title}>
            <h3 className="text-xl font-semibold mb-2">{p.title}</h3>
            <p>{p.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Page — default export
   ──────────────────────────────────────────────────────────────────────────── */
export default function NiBinGuyLandingPage() {
  const [showBooking, setShowBooking] = useState(false);
  const [bookingPrefillAddress, setBookingPrefillAddress] = useState("");

  const openBooking = (addressOrEvent) => {
    setBookingPrefillAddress(typeof addressOrEvent === "string" ? addressOrEvent : "");
    setShowBooking(true);
  };
  const [showContact, setShowContact] = useState(false);
  const [showChallenge, setShowChallenge] = useState(false);
  const [showBinChecker, setShowBinChecker] = useState(false);
  const [showCoverageChecker, setShowCoverageChecker] = useState(false);

  const closeBookingAndReturnTop = () => {
    setShowBooking(false);
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
    });
  };

  return (
  <main id="main-content" tabIndex="-1" className="n64-world min-h-screen bg-black text-white font-sans relative">
      <Hero onBook={openBooking} onContact={() => {window.n64Score?.awardAction("contact");setShowContact(true);}} onChallenge={() => setShowChallenge(true)} onBinChecker={() => setShowBinChecker(true)} onCoverage={() => setShowCoverageChecker(true)} />

      {/* Page-anchored quick actions scroll with the hero; only the menu remains floating. */}
      <div className="n64-top-actions absolute left-[14px] top-[14px] z-40 flex max-w-[calc(100vw-94px)] items-center gap-2" role="group" aria-label="Quick actions">
        <button
          type="button"
          onClick={() => setShowCoverageChecker(true)}
          aria-label="Check whether we cover your postcode"
          aria-haspopup="dialog"
          className="n64-top-action n64-top-action--area"
        >
          <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#236c85" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
            <circle cx="12" cy="10" r="2.5" />
          </svg>
          <span>Check Your Area</span>
        </button>
        <button
          type="button"
          onClick={() => openBooking()}
          aria-haspopup="dialog"
          className="n64-top-action n64-top-action--book"
        >
          Book a Clean
        </button>
      </div>

      <Modal
        open={showCoverageChecker}
        onClose={() => setShowCoverageChecker(false)}
        maxWidth="max-w-lg"
        labelledBy="coverage-checker-title"
        dark
      >
        <CoverageChecker
          compact
          onClose={() => setShowCoverageChecker(false)}
          onBook={(address) => {
            setShowCoverageChecker(false);
            openBooking(address);
          }}
        />
      </Modal>

      {/* Booking Modal */}
      <Modal open={showBooking} onClose={closeBookingAndReturnTop} maxWidth="max-w-md" labelledBy="booking-title">
        <BookingForm onClose={closeBookingAndReturnTop} initialAddress={bookingPrefillAddress} />
      </Modal>

      {/* Contact Modal */}
      <Modal open={showContact} onClose={() => setShowContact(false)} maxWidth="max-w-md" labelledBy="contact-title">
        <ContactForm onClose={() => setShowContact(false)} />
      </Modal>

      <Modal open={showBinChecker} onClose={() => setShowBinChecker(false)} maxWidth="max-w-md" labelledBy="bin-checker-title">
        <Suspense fallback={<p className="p-8 text-center">Loading bin checker…</p>}>
          <BinCheckerModal onClose={() => setShowBinChecker(false)} />
        </Suspense>
      </Modal>

      {/* 10 Second Challenge Modal */}
      <ChallengeModal open={showChallenge} onClose={() => setShowChallenge(false)} />

      <WhatWeDo />
      <TheProcess onBook={openBooking} />
      <BinsWeClean />
      <WhyCleanYourBin />
      <WhyNiBinGuy />
      {/* Support sections are bonus content, not numbered arcade levels. */}
      <div className="n64-support-sections">
        <CustomerReviews />
        <CustomerQuestions onBook={openBooking} />
      </div>
    </main>
  );
}
