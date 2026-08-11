const { readFileSync, writeFileSync } = require("fs");
const { resolve } = require("path");

const VERSION = "August 2026";

const FULL_TERMS = `We keep our Terms of Service simple and transparent. By booking or receiving a bin clean from Ni Bin Guy, you agree to:

1) Service & Contracts
• Regular 4-weekly plans are based on a 13-clean minimum term, which is approximately 12 months, unless agreed otherwise.
• One-off cleans have no minimum term.
• Each bin is treated separately; adding another bin may start a new agreement for that bin.
• Bookings and plans are not transferable without our agreement.

2) Bin Availability
• Bins must be left out or made accessible on the scheduled cleaning day and must remain available until 8pm.
• If your bin is not available when we attend, or access is blocked, the clean will still be charged.
• If we are unable to attend on the scheduled day, we will notify you and rearrange the clean as soon as reasonably possible.
• We may be unable to clean if the bin has not been emptied by the council, is too heavy to move safely, or contains unsafe or excessive waste.

3) Cancellations & Minimum Term
• One-off cleans may be cancelled up to 24 hours before the scheduled clean day without charge.
• If a one-off clean is cancelled with less than 24 hours’ notice, or the bin is not available when we attend, the clean may still be charged in full.
• A 4-weekly plan may be cancelled any time up to 24 hours before the second scheduled clean. If cancelled before the second clean, the first clean will be charged at the standard one-off clean price, and any difference between the 4-weekly price and one-off price will become payable.
• After the second clean, the 4-weekly plan continues for the full 13-clean minimum term.
• If the customer cancels before the end of the 13-clean minimum term, they will remain liable for the outstanding balance for the remaining cleans within the 12-month minimum term.
• After the 13-clean minimum term has been completed, the plan continues on a rolling basis and may be cancelled by giving at least 30 days’ notice.

4) One-Off Cleans & Animal Waste
• One-off cleans containing dog faeces, cat litter, animal bedding, or other animal faeces/waste will incur a £5 surcharge per affected bin.
• We may refuse to clean bins containing excessive animal waste, hazardous waste, sharp items, medical waste, chemicals, paint, oil, rubble, hot ashes, or anything unsafe.

5) Cleaning Process
• Bins are cleaned inside and outside where safe using pressurised water and detergent.
• Some stains, ingrained smells, paint, tar, or long-term residue may take multiple visits or may not fully remove.
• Any loosened waste may be bagged and left in your bin for disposal.
• Please keep at least 5 metres away during cleaning.

6) Payments
• Payment is due within 7 days of each clean unless agreed otherwise.
• Accepted payment methods are Direct Debit, Bank Transfer, and Card. No cash.
• Cancelling a Direct Debit does not cancel your service or contract. Cancellation must be requested directly with Ni Bin Guy.
• If a 4-weekly plan is cancelled early, any outstanding balance due under the minimum term may still be payable.
• Overdue accounts may result in service being stopped and may be referred for recovery.

7) Customer Responsibilities
• Please keep your contact details, address, and payment details up to date.
• Please tell us in advance if your bin will not be available.
• Please make sure gates are unlocked, access is safe, and pets are secured where needed.
• By booking, you authorise Ni Bin Guy to use a suitable external water tap at the service address, where available, to refill our cleaning tank or equipment as reasonably required to carry out the service.
• We have zero tolerance for abuse, threats, or harassment toward staff, including online abuse.

8) Other Terms
• We may place a small sticker or service tag on your bin.
• Discounts are discretionary and may be withdrawn or changed.
• Prices may change outside of any agreed fixed term.

9) Data & Communication
• You consent to us storing your details and contacting you about your booking, schedule, payment, and service.
• Text reminders are a courtesy only. You remain responsible for knowing your scheduled clean date.`;

const EMAIL_TERMS = `Ni Bin Guy – Terms of Service\n\n${FULL_TERMS}`;

function updateFile(path, updater) {
  const filePath = resolve(process.cwd(), path);
  const before = readFileSync(filePath, "utf8");
  const after = updater(before);
  if (after !== before) {
    writeFileSync(filePath, after, "utf8");
    console.log(`Updated ${path}`);
  } else {
    console.log(`${path} already up to date`);
  }
}

updateFile("src/LandingPage.jsx", (text) => {
  text = text.replace(/const TERMS_VERSION = "[^"]+";/, `const TERMS_VERSION = "${VERSION}";`);
  text = text.replace(/const TERMS_BODY = `.*?`;/s, `const TERMS_BODY = \`${FULL_TERMS}\`;`);

  if (!text.includes("isWhatsAppSubmitting")) {
    text = text.replace(
      '  const [agreeToTerms, setAgreeToTerms] = useState(false);',
      '  const [agreeToTerms, setAgreeToTerms] = useState(false);\n  const [isWhatsAppSubmitting, setIsWhatsAppSubmitting] = useState(false);'
    );
  }
  if (!text.includes("isEmailSubmitting")) {
    text = text.replace(
      '  const [isWhatsAppSubmitting, setIsWhatsAppSubmitting] = useState(false);',
      '  const [isWhatsAppSubmitting, setIsWhatsAppSubmitting] = useState(false);\n  const [isEmailSubmitting, setIsEmailSubmitting] = useState(false);'
    );
  }
  if (!text.includes("bookingSubmitLockRef")) {
    text = text.replace(
      '  const [isEmailSubmitting, setIsEmailSubmitting] = useState(false);',
      '  const [isEmailSubmitting, setIsEmailSubmitting] = useState(false);\n  const bookingSubmitLockRef = useRef(false);'
    );
  }

  text = text.replace("const handleSendWhatsApp = () => {", "const handleSendWhatsApp = async () => {");

  if (!text.includes('bookingSubmitLockRef.current = true;\n    setIsWhatsAppSubmitting(true);')) {
    text = text.replace(
      '    const payload = {\n      source: "whatsapp",',
      '    if (bookingSubmitLockRef.current) return;\n    bookingSubmitLockRef.current = true;\n    setIsWhatsAppSubmitting(true);\n\n    const payload = {\n      source: "whatsapp",'
    );
  }

  if (!text.includes('bookingSubmitLockRef.current = true;\n    setIsEmailSubmitting(true);')) {
    text = text.replace(
      '    // ✅ reCAPTCHA token (v3)\n    const recaptchaAction = "booking_submit";',
      '    if (bookingSubmitLockRef.current) return;\n    bookingSubmitLockRef.current = true;\n    setIsEmailSubmitting(true);\n\n    // ✅ reCAPTCHA token (v3)\n    const recaptchaAction = "booking_submit";'
    );
  }

  text = text.replace(
    '    if (!recaptchaToken) {\n      alert("Anti-bot check not ready. Please try again in a moment.");',
    '    if (!recaptchaToken) {\n      bookingSubmitLockRef.current = false;\n      setIsEmailSubmitting(false);\n      alert("Anti-bot check not ready. Please try again in a moment.");'
  );

  text = text.replace(
    '    console.error("Email failed:", errorText);\n    alert("Failed to send booking email: " + errorText);',
    '    bookingSubmitLockRef.current = false;\n    setIsEmailSubmitting(false);\n    console.error("Email failed:", errorText);\n    alert("Failed to send booking email: " + errorText);'
  );

  text = text.replace(
    '  console.error(err);\n  alert("Error sending booking.");',
    '  bookingSubmitLockRef.current = false;\n  setIsEmailSubmitting(false);\n  console.error(err);\n  alert("Error sending booking.");'
  );

  text = text.replace(
    '      <button onClick={handleSendWhatsApp} className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-6 rounded-lg w-full disabled:opacity-60" disabled={!agreeToTerms}>\n        Send via WhatsApp\n      </button>',
    '      <button onClick={handleSendWhatsApp} className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-6 rounded-lg w-full disabled:opacity-60" disabled={!agreeToTerms || isWhatsAppSubmitting || isEmailSubmitting}>\n        {isWhatsAppSubmitting ? "Sending booking..." : "Send via WhatsApp"}\n      </button>'
  );

  text = text.replace(
    '      <button onClick={handleSendEmail} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-lg w-full disabled:opacity-60" disabled={!agreeToTerms}>\n        Send via Email\n      </button>',
    '      <button onClick={handleSendEmail} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-lg w-full disabled:opacity-60" disabled={!agreeToTerms || isEmailSubmitting || isWhatsAppSubmitting}>\n        {isEmailSubmitting ? "Sending booking..." : "Send via Email"}\n      </button>'
  );

  if (!text.includes("Your booking is being sent")) {
    text = text.replace(
      '      <TermsModal',
      '      {(isEmailSubmitting || isWhatsAppSubmitting) && (\n        <div className="fixed left-1/2 bottom-5 -translate-x-1/2 z-[9999] flex items-center gap-3 rounded-full bg-black/95 px-5 py-3 text-white shadow-2xl border border-white/20" role="status" aria-live="polite">\n          <span className="inline-block h-5 w-5 rounded-full border-2 border-white/40 border-t-white animate-spin" aria-hidden="true" />\n          <span className="text-sm font-bold whitespace-nowrap">Your booking is being sent...</span>\n        </div>\n      )}\n\n      <TermsModal'
    );
  }

  return text;
});

updateFile("netlify/functions/sendBookingEmail.js", (text) => {
  text = text.replace(/const TERMS_VERSION_DEFAULT = "[^"]+";/, `const TERMS_VERSION_DEFAULT = "${VERSION}";`);
  text = text.replace(/const TERMS_BODY = `.*?`;/s, `const TERMS_BODY = \`\n${EMAIL_TERMS}\n\`;`);
  return text;
});

updateFile("netlify/functions/sendTosReceipt.js", (text) => {
  text = text.replace(/const TERMS_VERSION_DEFAULT = "[^"]+";/, `const TERMS_VERSION_DEFAULT = "${VERSION}";`);
  return text;
});

updateFile("netlify/functions/lib/termsPdf.js", (text) => {
  text = text.replace(/const DEFAULT_TERMS_BODY = `.*?`;/s, `const DEFAULT_TERMS_BODY = \`${FULL_TERMS}\`;`);
  return text;
});

updateFile("netlify/functions/lib/bookingEmailTemplate.js", (text) => {
  return text.replace("Your first clean is one step closer.", "Your clean is one step closer.");
});
