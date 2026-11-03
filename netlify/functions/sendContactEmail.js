// netlify/functions/sendContactEmail.js
// Requires: npm i resend
// Env vars in Netlify:
//   RESEND_API_KEY
//   CONTACT_TO   (e.g. info@nibing.uy)
//   RESEND_FROM  (must be a VERIFIED sender/domain in Resend, e.g. "Ni Bin Guy <hello@nibinguy.co.uk>")
//   RECAPTCHA_SECRET_KEY
// Optional:
//   RECAPTCHA_MIN_SCORE (default 0.5)

import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY || "";
const RECAPTCHA_MIN_SCORE = Number(process.env.RECAPTCHA_MIN_SCORE || "0.5");

// ---- helpers ----
async function readJson(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function jsonResponse(payload, status = 200) {
  // Basic CORS (handy if calling from browser)
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

async function verifyRecaptcha({ token, expectedAction }) {
  if (!RECAPTCHA_SECRET) return { ok: false, reason: "missing_secret" };
  if (!token) return { ok: false, reason: "missing_token" };

  const res = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: RECAPTCHA_SECRET,
      response: token,
    }),
  });

  const data = await res.json();

  if (!data?.success) return { ok: false, reason: "not_success", data };

  // v3 action check (recommended)
  if (expectedAction && data.action && data.action !== expectedAction) {
    return { ok: false, reason: "action_mismatch", data };
  }

  // v3 score check
  if (typeof data.score === "number" && data.score < RECAPTCHA_MIN_SCORE) {
    return { ok: false, reason: "low_score", data };
  }

  return { ok: true, data };
}

// ---- handler ----
export default async function handler(req) {
  // Handle preflight (CORS)
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // Validate required env vars early
  if (!process.env.RESEND_API_KEY) {
    return jsonResponse({ error: "Missing RESEND_API_KEY env var" }, 500);
  }

  const toEnv = process.env.CONTACT_TO || "info@nibing.uy";
  const fromEnv = process.env.RESEND_FROM;

  if (!fromEnv) {
    // IMPORTANT: From must be verified in Resend
    return jsonResponse(
      { error: "Missing RESEND_FROM env var (must be a verified sender in Resend)" },
      500
    );
  }

  const body = await readJson(req);
  if (!body) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  // ✅ reCAPTCHA guard
  const recaptchaToken = body.recaptchaToken || null;
  const recaptchaAction = body.recaptchaAction || "contact_submit";

  const recaptcha = await verifyRecaptcha({
    token: recaptchaToken,
    expectedAction: recaptchaAction,
  });

  if (!recaptcha.ok) {
    // Keep response generic so bots don’t learn
    console.warn("reCAPTCHA blocked contact:", recaptcha.reason, recaptcha.data || "");
    return jsonResponse({ error: "Anti-bot check failed" }, 403);
  }

  const { name = "", email = "", phone = "", message = "" } = body;

  // Basic validation
  if (!name.trim() || !email.trim() || !phone.trim() || !message.trim()) {
  return jsonResponse({ error: "All fields are required." }, 400);
}

if (!/^[0-9]{11}$/.test(phone)) {
  return jsonResponse({ error: "Phone number must be exactly 11 digits." }, 400);
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  return jsonResponse({ error: "Invalid email address format." }, 400);
}

  const subject = `New Contact Message from ${name.trim()}`;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#111">
      <h2>New Contact Message</h2>
      <p><strong>Name:</strong> ${escapeHtml(name)}</p>
      <p><strong>Email:</strong> ${escapeHtml(email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(phone)}</p>
      <p><strong>Message:</strong><br>${escapeHtml(message).replace(/\n/g, "<br>")}</p>

      <hr>
      <p style="font-size:13px;color:#555;margin:0">
        Sent from nibing.uy contact form
      </p>
      <p style="font-size:12px;color:#777;margin:6px 0 0">
        reCAPTCHA: action=${escapeHtml(recaptchaAction)}, score=${escapeHtml(
          String(recaptcha?.data?.score ?? "n/a")
        )}
      </p>
    </div>
  `;

  const text = `New Contact Message

Name: ${name}
Email: ${email}
Phone: ${phone}

Message:
${message}

reCAPTCHA: action=${recaptchaAction}, score=${recaptcha?.data?.score ?? "n/a"}
`;

  try {
    const { data, error } = await resend.emails.send({
      from: fromEnv,
      to: [toEnv],          // array is safest
      subject,
      html,
      text,
      replyTo: email.trim() // Resend uses replyTo (NOT reply_to)
    });

    if (error) {
      console.error("Resend error:", error);
      return jsonResponse({ error: "Failed to send email", details: error }, 500);
    }

    return jsonResponse({ ok: true, id: data?.id || null }, 200);
  } catch (e) {
    console.error("Server error:", e);
    return jsonResponse({ error: "Server error" }, 500);
  }
}
