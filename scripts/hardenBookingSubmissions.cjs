const { readFileSync, writeFileSync } = require("fs");
const { resolve } = require("path");

function updateFile(path, transform) {
  const filePath = resolve(process.cwd(), path);
  const before = readFileSync(filePath, "utf8");
  const after = transform(before);
  if (after !== before) {
    writeFileSync(filePath, after, "utf8");
    console.log(`Hardened ${path}`);
  } else {
    console.log(`${path} already hardened`);
  }
}

function mustReplace(text, from, to, label) {
  if (text.includes(to)) return text;
  if (!text.includes(from)) throw new Error(`Could not apply booking hardening patch: ${label}`);
  return text.replace(from, to);
}

updateFile("src/LandingPage.jsx", (text) => {
  if (!text.includes("function createBookingSubmissionMeta()")) {
    text = mustReplace(
      text,
      'const DEFAULT_BIN = { type: "", count: 1, planId: "domestic_4w" };',
      `function createBookingSubmissionMeta() {\n  const now = new Date();\n  const randomSource = globalThis.crypto?.randomUUID?.().replace(/-/g, "") || Math.random().toString(36).slice(2);\n  const randomPart = String(randomSource).replace(/[^a-z0-9]/gi, "").slice(0, 10).padEnd(8, "0").toUpperCase();\n  return {\n    bookingId: \`NBG-\${Date.now().toString(36).toUpperCase()}-\${randomPart}\`,\n    submittedAt: now.toISOString(),\n  };\n}\n\nconst DEFAULT_BIN = { type: "", count: 1, planId: "domestic_4w" };`,
      "client submission metadata helper"
    );
  }

  if (!text.includes('const submissionMeta = createBookingSubmissionMeta();\n\n    const payload = {\n      ...submissionMeta,\n      source: "whatsapp",')) {
    text = mustReplace(
      text,
      '    const payload = {\n      source: "whatsapp",',
      '    const submissionMeta = createBookingSubmissionMeta();\n\n    const payload = {\n      ...submissionMeta,\n      source: "whatsapp",',
      "WhatsApp submission metadata"
    );
  }

  if (!text.includes('const emailSubmissionMeta = createBookingSubmissionMeta();')) {
    text = mustReplace(
      text,
      '    // ✅ reCAPTCHA token (v3)\n    const recaptchaAction = "booking_submit";',
      '    const emailSubmissionMeta = createBookingSubmissionMeta();\n\n    // ✅ reCAPTCHA token (v3)\n    const recaptchaAction = "booking_submit";',
      "email submission metadata"
    );
  }

  if (!text.includes('body: JSON.stringify({\n      ...emailSubmissionMeta,\n      name,')) {
    text = mustReplace(
      text,
      '    body: JSON.stringify({\n      name,',
      '    body: JSON.stringify({\n      ...emailSubmissionMeta,\n      name,',
      "email payload metadata"
    );
  }

  return text;
});

updateFile("netlify/functions/sendBookingEmail.js", (text) => {
  if (!text.includes('require("./lib/bookingSubmissionGuard")')) {
    text = mustReplace(
      text,
      'const { buildBookingEmailHtml } = require("./lib/bookingEmailTemplate");',
      'const { buildBookingEmailHtml } = require("./lib/bookingEmailTemplate");\nconst { validateBookingSubmission, claimBookingSubmission, submissionErrorResponse } = require("./lib/bookingSubmissionGuard");',
      "sendBookingEmail guard import"
    );
  }

  if (!text.includes('const submission = validateBookingSubmission(payload);')) {
    text = mustReplace(
      text,
      '    const payload = JSON.parse(event.body || "{}");\n    const recaptchaToken = payload.recaptchaToken || null;',
      '    const payload = JSON.parse(event.body || "{}");\n    const submission = validateBookingSubmission(payload);\n    if (!submission.ok) return submissionErrorResponse(submission);\n    const claim = await claimBookingSubmission({ ...submission, channel: "email" });\n    if (!claim.ok) return submissionErrorResponse({ ...submission, duplicate: true });\n\n    const recaptchaToken = payload.recaptchaToken || null;',
      "sendBookingEmail validation and replay claim"
    );
  }

  text = text.replace(
    '    const subjectAdmin = `🗑️ New Bin Cleaning Booking (${source})`;',
    '    const subjectAdmin = `🗑️ New Bin Cleaning Booking (${source}) — ${submission.bookingId}`;'
  );

  if (!text.includes('Booking reference: ${submission.bookingId}')) {
    text = mustReplace(
      text,
      '    const textAdmin = `New Bin Cleaning Booking\\n\\nName: ${name}',
      '    const textAdmin = `New Bin Cleaning Booking\\n\\nBooking reference: ${submission.bookingId}\\nSubmitted by customer: ${submission.submittedAt}\\nReceived by server: ${submission.serverReceivedAt}\\n\\nName: ${name}',
      "sendBookingEmail text timestamps"
    );
  }

  if (!text.includes('<strong>Booking reference:</strong> ${escapeHtml(submission.bookingId)}')) {
    text = mustReplace(
      text,
      '      <h2>New Bin Cleaning Booking</h2>\n      <p><strong>Name:</strong> ${escapeHtml(name)}</p>',
      '      <h2>New Bin Cleaning Booking</h2>\n      <div style="background:#fff7ed;border:1px solid #fb923c;border-radius:8px;padding:12px;margin:0 0 16px"><p style="margin:0 0 4px"><strong>Booking reference:</strong> ${escapeHtml(submission.bookingId)}</p><p style="margin:0 0 4px"><strong>Submitted by customer:</strong> ${escapeHtml(submission.submittedAt)}</p><p style="margin:0"><strong>Received by server:</strong> ${escapeHtml(submission.serverReceivedAt)}</p></div>\n      <p><strong>Name:</strong> ${escapeHtml(name)}</p>',
      "sendBookingEmail html timestamps"
    );
  }

  if (!text.includes('      bookingId: submission.bookingId,')) {
    text = mustReplace(
      text,
      '      channel: "email",\n      name,',
      '      channel: "email",\n      bookingId: submission.bookingId,\n      submittedAt: submission.submittedAt,\n      serverReceivedAt: submission.serverReceivedAt,\n      name,',
      "sendBookingEmail audit metadata"
    );
  }

  if (!text.includes('        bookingId: submission.bookingId,')) {
    text = mustReplace(
      text,
      '        success: true,\n        customerConfirmationSent:',
      '        success: true,\n        bookingId: submission.bookingId,\n        submittedAt: submission.submittedAt,\n        serverReceivedAt: submission.serverReceivedAt,\n        customerConfirmationSent:',
      "sendBookingEmail response metadata"
    );
  }

  return text;
});

updateFile("netlify/functions/sendTosReceipt.js", (text) => {
  if (!text.includes('require("./lib/bookingSubmissionGuard")')) {
    text = mustReplace(
      text,
      'const { buildTermsAcceptancePdfAttachment } = require("./lib/termsPdf");',
      'const { buildTermsAcceptancePdfAttachment } = require("./lib/termsPdf");\nconst { validateBookingSubmission, claimBookingSubmission, submissionErrorResponse } = require("./lib/bookingSubmissionGuard");',
      "sendTosReceipt guard import"
    );
  }

  if (!text.includes('async function sendManualBookingOwnerEmail(payload, bins, schedule, submission)')) {
    text = mustReplace(
      text,
      'async function sendManualBookingOwnerEmail(payload, bins, schedule) {',
      'async function sendManualBookingOwnerEmail(payload, bins, schedule, submission) {',
      "manual email submission argument"
    );
  }

  if (!text.includes('    `Booking reference: ${submission.bookingId}`,')) {
    text = mustReplace(
      text,
      '    "New WhatsApp Bin Cleaning Booking",\n    "",\n    "NEXT CLEAN DATE: MANUAL CONFIRMATION REQUIRED",',
      '    "New WhatsApp Bin Cleaning Booking",\n    "",\n    `Booking reference: ${submission.bookingId}`,\n    `Submitted by customer: ${submission.submittedAt}`,\n    `Received by server: ${submission.serverReceivedAt}`,\n    "",\n    "NEXT CLEAN DATE: MANUAL CONFIRMATION REQUIRED",',
      "manual WhatsApp text timestamps"
    );
  }

  if (!text.includes('<strong>Booking reference:</strong> ${escapeHtml(submission.bookingId)}')) {
    text = mustReplace(
      text,
      '      <div style="border:1px solid #e5e7eb;border-top:0;padding:22px;border-radius:0 0 12px 12px;">\n        <p><strong>Name:</strong> ${escapeHtml(name)}</p>',
      '      <div style="border:1px solid #e5e7eb;border-top:0;padding:22px;border-radius:0 0 12px 12px;">\n        <div style="background:#fff7ed;border:1px solid #fb923c;border-radius:8px;padding:12px;margin:0 0 16px"><p style="margin:0 0 4px"><strong>Booking reference:</strong> ${escapeHtml(submission.bookingId)}</p><p style="margin:0 0 4px"><strong>Submitted by customer:</strong> ${escapeHtml(submission.submittedAt)}</p><p style="margin:0"><strong>Received by server:</strong> ${escapeHtml(submission.serverReceivedAt)}</p></div>\n        <p><strong>Name:</strong> ${escapeHtml(name)}</p>',
      "manual WhatsApp html timestamps"
    );
  }

  if (!text.includes('body: JSON.stringify({ success: true, automatic: false, ownerNotificationSent: true, bookingId: submission.bookingId })')) {
    text = mustReplace(
      text,
      '    body: JSON.stringify({ success: true, automatic: false, ownerNotificationSent: true }),',
      '    body: JSON.stringify({ success: true, automatic: false, ownerNotificationSent: true, bookingId: submission.bookingId }),',
      "manual WhatsApp response booking id"
    );
  }

  if (!text.includes('const submission = validateBookingSubmission(payload);')) {
    text = mustReplace(
      text,
      '    const payload = JSON.parse(event.body || "{}");\n    const bins =',
      '    const payload = JSON.parse(event.body || "{}");\n    const submission = validateBookingSubmission(payload);\n    if (!submission.ok) return submissionErrorResponse(submission);\n\n    const bins =',
      "sendTosReceipt validation"
    );
  }

  if (!text.includes('const claim = await claimBookingSubmission({ ...submission, channel: "whatsapp-manual" });')) {
    text = mustReplace(
      text,
      '    if (!automatic) {\n      return await sendManualBookingOwnerEmail(payload, bins, schedule);\n    }',
      '    if (!automatic) {\n      const claim = await claimBookingSubmission({ ...submission, channel: "whatsapp-manual" });\n      if (!claim.ok) return submissionErrorResponse({ ...submission, duplicate: true });\n      return await sendManualBookingOwnerEmail(payload, bins, schedule, submission);\n    }',
      "manual WhatsApp replay claim"
    );
  }

  return text;
});

updateFile("netlify/functions/sendAutomaticBookingConfirmation.js", (text) => {
  if (!text.includes('require("./lib/bookingSubmissionGuard")')) {
    text = mustReplace(
      text,
      'const { buildTermsAcceptancePdfAttachment } = require("./lib/termsPdf");',
      'const { buildTermsAcceptancePdfAttachment } = require("./lib/termsPdf");\nconst { validateBookingSubmission, claimBookingSubmission, submissionErrorResponse } = require("./lib/bookingSubmissionGuard");',
      "automatic confirmation guard import"
    );
  }

  if (!text.includes('const submission = validateBookingSubmission(payload);')) {
    text = mustReplace(
      text,
      '    const payload = JSON.parse(event.body || "{}");\n    const {',
      '    const payload = JSON.parse(event.body || "{}");\n    const submission = validateBookingSubmission(payload);\n    if (!submission.ok) return submissionErrorResponse(submission);\n    const claim = await claimBookingSubmission({ ...submission, channel: payload.source === "whatsapp" ? "whatsapp-auto" : "email-auto" });\n    if (!claim.ok) return submissionErrorResponse({ ...submission, duplicate: true });\n\n    const {',
      "automatic confirmation validation and replay claim"
    );
  }

  if (!text.includes('<strong>Booking reference:</strong> ${escapeHtml(submission.bookingId)}')) {
    text = mustReplace(
      text,
      '    const adminHtml = `\n      <h2>Automatically scheduled booking</h2>\n      <p><strong>Name:</strong> ${escapeHtml(name)}</p>',
      '    const adminHtml = `\n      <h2>Automatically scheduled booking</h2>\n      <div style="background:#ecfdf5;border:1px solid #34d399;border-radius:8px;padding:12px;margin:0 0 16px"><p style="margin:0 0 4px"><strong>Booking reference:</strong> ${escapeHtml(submission.bookingId)}</p><p style="margin:0 0 4px"><strong>Submitted by customer:</strong> ${escapeHtml(submission.submittedAt)}</p><p style="margin:0"><strong>Received by server:</strong> ${escapeHtml(submission.serverReceivedAt)}</p></div>\n      <p><strong>Name:</strong> ${escapeHtml(name)}</p>',
      "automatic admin html timestamps"
    );
  }

  text = text.replace(
    '        subject: `✅ Auto-booked: ${name || address}`,',
    '        subject: `✅ Auto-booked: ${name || address} — ${submission.bookingId}`,'
  );

  if (!text.includes('Booking reference: ${submission.bookingId}\\nSubmitted by customer: ${submission.submittedAt}')) {
    text = mustReplace(
      text,
      '        text: `Automatically scheduled booking\\n\\nName: ${name}',
      '        text: `Automatically scheduled booking\\n\\nBooking reference: ${submission.bookingId}\\nSubmitted by customer: ${submission.submittedAt}\\nReceived by server: ${submission.serverReceivedAt}\\n\\nName: ${name}',
      "automatic admin text timestamps"
    );
  }

  return text;
});
