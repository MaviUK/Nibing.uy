const crypto = require("crypto");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const DEFAULT_TERMS_BODY = `We keep our Terms of Service simple and transparent. By booking or receiving a bin clean from Ni Bin Guy, you agree to:

1) Service & Contracts
- Regular 4-weekly plans are based on a 13-clean minimum term, which is approximately 12 months, unless agreed otherwise.
- One-off cleans have no minimum term.
- Each bin is treated separately; adding another bin may start a new agreement for that bin.
- Bookings and plans are not transferable without our agreement.

2) Bin Availability
- Bins must be left out or made accessible on the scheduled cleaning day and must remain available until 8pm.
- If your bin is not available when we attend, or access is blocked, the clean may still be charged.
- If we are unable to attend on the scheduled day, we will notify you and rearrange the clean as soon as reasonably possible.
- We may be unable to clean if the bin has not been emptied by the council, is too heavy to move safely, or contains unsafe or excessive waste.

3) Cancellations & Minimum Term
- One-off cleans may be cancelled up to 24 hours before the scheduled clean day without charge.
- If a one-off clean is cancelled with less than 24 hours notice, or the bin is not available when we attend, the clean may still be charged in full.
- A 4-weekly plan may be cancelled any time up to 24 hours before the second scheduled clean. If cancelled before the second clean, the first clean will be charged at the standard one-off clean price, and any difference between the 4-weekly price and one-off price will become payable.
- After the second clean, the 4-weekly plan continues for the full 13-clean minimum term.
- If the customer cancels before the end of the 13-clean minimum term, they will remain liable for the outstanding balance for the remaining cleans within the 12-month minimum term.
- After the 13-clean minimum term has been completed, the plan continues on a rolling basis and may be cancelled by giving at least 30 days notice.

4) One-Off Cleans & Animal Waste
- One-off cleans containing dog faeces, cat litter, animal bedding, or other animal faeces/waste will incur a GBP 5 surcharge per affected bin.
- We may refuse to clean bins containing excessive animal waste, hazardous waste, sharp items, medical waste, chemicals, paint, oil, rubble, hot ashes, or anything unsafe.

5) Cleaning Process
- Bins are cleaned inside and outside where safe using pressurised water and detergent.
- Some stains, ingrained smells, paint, tar, or long-term residue may take multiple visits or may not fully remove.
- Any loosened waste may be bagged and left in your bin for disposal.
- Please keep at least 5 metres away during cleaning.

6) Payments
- Payment is due within 7 days of each clean unless agreed otherwise.
- Accepted payment methods are Direct Debit, Bank Transfer, and Card. No cash.
- Cancelling a Direct Debit does not cancel your service or contract. Cancellation must be requested directly with Ni Bin Guy.
- If a 4-weekly plan is cancelled early, any outstanding balance due under the minimum term may still be payable.
- Overdue accounts may result in service being stopped and may be referred for recovery.

7) Customer Responsibilities
- Please keep your contact details, address, and payment details up to date.
- Please tell us in advance if your bin will not be available.
- Please make sure gates are unlocked, access is safe, and pets are secured where needed.
- We have zero tolerance for abuse, threats, or harassment toward staff, including online abuse.

8) Other Terms
- We may place a small sticker or service tag on your bin.
- Discounts are discretionary and may be withdrawn or changed.
- Prices may change outside of any agreed fixed term.

9) Data & Communication
- You consent to us storing your details and contacting you about your booking, schedule, payment, and service.
- Text reminders are a courtesy only. You remain responsible for knowing your scheduled clean date.`;

const BRAND = {
  black: rgb(0.02, 0.02, 0.02),
  yellow: rgb(1, 0.83, 0),
  red: rgb(0.77, 0.07, 0.16),
  white: rgb(1, 1, 1),
  ink: rgb(0.08, 0.08, 0.08),
  grey: rgb(0.42, 0.42, 0.42),
  pale: rgb(0.96, 0.96, 0.96),
};

function pdfSafe(value) {
  return String(value ?? "")
    .replace(/£/g, "GBP ")
    .replace(/•/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function safeFilePart(value) {
  const cleaned = String(value || "customer").trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return cleaned || "customer";
}

function wrapText(text, font, fontSize, maxWidth) {
  const lines = [];
  for (const paragraph of pdfSafe(text).split(/\r?\n/)) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    const words = paragraph.trim().split(/\s+/);
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, fontSize) <= maxWidth) line = test;
      else {
        if (line) lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function ukDateTime(iso) {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch (_) {
    return iso || "";
  }
}

function buildHash(data) {
  const payload = {
    name: data.name || "",
    email: data.email || "",
    phone: data.phone || "",
    address: data.address || "",
    binsText: data.binsText || "",
    pricingText: data.pricingText || "",
    termsAccepted: !!data.termsAccepted,
    termsVersion: data.termsVersion || "",
    termsAcceptanceText: data.termsAcceptanceText || "",
    termsTimestamp: data.termsTimestamp || "",
    termsBody: data.termsBody || DEFAULT_TERMS_BODY,
    source: data.source || "website",
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function tryEmbedLogo(pdfDoc) {
  try {
    const response = await fetch("https://nibing.uy/logo.png");
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return await pdfDoc.embedPng(bytes);
  } catch (_) {
    return null;
  }
}

async function buildTermsAcceptancePdfAttachment(data) {
  const termsBody = data.termsBody || DEFAULT_TERMS_BODY;
  const verificationHash = buildHash({ ...data, termsBody });

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle("Ni Bin Guy Terms Acceptance Certificate");
  pdfDoc.setAuthor("Ni Bin Guy");
  pdfDoc.setSubject("Customer digital acceptance of terms and conditions");
  pdfDoc.setKeywords(["Ni Bin Guy", "Terms", "Acceptance", "Booking"]);
  pdfDoc.setCreationDate(new Date());

  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logo = await tryEmbedLogo(pdfDoc);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const margin = 42;
  const contentWidth = pageWidth - margin * 2;
  const footerTop = 46;
  let page;
  let y;
  let pageNumber = 0;

  const drawBrandHeader = (firstPage = false) => {
    const headerHeight = firstPage ? 150 : 74;
    page.drawRectangle({ x: 0, y: pageHeight - headerHeight, width: pageWidth, height: headerHeight, color: BRAND.black });
    page.drawRectangle({ x: 0, y: pageHeight - headerHeight - 6, width: pageWidth, height: 6, color: BRAND.yellow });

    if (logo) {
      const ratio = logo.width / logo.height;
      const h = firstPage ? 62 : 38;
      const w = h * ratio;
      page.drawImage(logo, { x: margin, y: pageHeight - h - (firstPage ? 24 : 18), width: w, height: h });
    } else {
      page.drawText("NI BIN GUY", { x: margin, y: pageHeight - (firstPage ? 60 : 44), size: firstPage ? 24 : 17, font: bold, color: BRAND.white });
      page.drawText("NO MORE DIRTY BINS", { x: margin, y: pageHeight - (firstPage ? 80 : 60), size: firstPage ? 10 : 8, font: bold, color: BRAND.red });
    }

    if (firstPage) {
      page.drawText("TERMS & CONDITIONS", { x: margin, y: pageHeight - 104, size: 25, font: bold, color: BRAND.white });
      page.drawText("ACCEPTANCE CERTIFICATE", { x: margin, y: pageHeight - 131, size: 21, font: bold, color: BRAND.yellow });
    } else {
      page.drawText("TERMS ACCEPTANCE CERTIFICATE", { x: 270, y: pageHeight - 44, size: 12, font: bold, color: BRAND.yellow });
    }
  };

  const drawFooter = () => {
    page.drawRectangle({ x: 0, y: 0, width: pageWidth, height: 34, color: BRAND.black });
    page.drawText(`Page ${pageNumber}`, { x: margin, y: 13, size: 8, font: regular, color: BRAND.white });
    page.drawText("nibing.uy  |  07555 178484  |  info@nibing.uy", { x: 180, y: 13, size: 8, font: regular, color: BRAND.yellow });
  };

  const addPage = (firstPage = false) => {
    if (page) drawFooter();
    page = pdfDoc.addPage([pageWidth, pageHeight]);
    pageNumber += 1;
    drawBrandHeader(firstPage);
    y = pageHeight - (firstPage ? 184 : 110);
  };

  const ensureSpace = (height) => {
    if (y - height < footerTop + 16) addPage(false);
  };

  const drawWrapped = (text, options = {}) => {
    const size = options.size || 10;
    const font = options.bold ? bold : regular;
    const lineGap = options.lineGap || size + 4;
    const indent = options.indent || 0;
    const color = options.color || BRAND.ink;
    const lines = wrapText(text, font, size, contentWidth - indent - (options.extraWidth || 0));
    for (const line of lines) {
      if (!line) {
        y -= lineGap / 2;
        continue;
      }
      ensureSpace(lineGap + 6);
      page.drawText(line, { x: margin + indent, y, size, font, color });
      y -= lineGap;
    }
  };

  const section = (title) => {
    y -= 12;
    ensureSpace(54);
    page.drawRectangle({ x: margin, y: y - 4, width: contentWidth, height: 28, color: BRAND.black });
    page.drawRectangle({ x: margin, y: y - 4, width: 7, height: 28, color: BRAND.yellow });
    page.drawText(pdfSafe(title).toUpperCase(), { x: margin + 16, y: y + 5, size: 12, font: bold, color: BRAND.white });
    y -= 44;
  };

  const detailRow = (label, value, highlight = false) => {
    const text = `${label}: ${value || ""}`;
    const lines = wrapText(text, highlight ? bold : regular, 10, contentWidth - 24);
    const h = Math.max(30, lines.length * 14 + 14);
    ensureSpace(h + 10);
    page.drawRectangle({ x: margin, y: y - h + 8, width: contentWidth, height: h, color: highlight ? BRAND.yellow : BRAND.pale });
    let ty = y - 8;
    for (const line of lines) {
      page.drawText(line, { x: margin + 12, y: ty, size: 10, font: highlight ? bold : regular, color: BRAND.ink });
      ty -= 14;
    }
    y -= h + 8;
  };

  addPage(true);

  page.drawRectangle({ x: margin, y: y - 54, width: contentWidth, height: 54, color: BRAND.yellow });
  page.drawText(data.termsAccepted ? "ACCEPTANCE RECORDED" : "ACCEPTANCE NOT RECORDED", { x: margin + 18, y: y - 24, size: 18, font: bold, color: BRAND.black });
  page.drawText("Digital record created from the Ni Bin Guy website booking request.", { x: margin + 18, y: y - 42, size: 9, font: regular, color: BRAND.black });
  y -= 76;

  section("Acceptance details");
  detailRow("Accepted", data.termsAccepted ? "Yes" : "No", true);
  detailRow("Terms version", data.termsVersion || "");
  detailRow("Accepted at", `${ukDateTime(data.termsTimestamp)} Europe/London`);
  detailRow("Acceptance wording", data.termsAcceptanceText || "");

  section("Customer details");
  detailRow("Name", data.name || "");
  detailRow("Email", data.email || "");
  detailRow("Phone", data.phone || "");
  detailRow("Address", data.address || "");
  detailRow("Booking source", data.source || "website");

  section("Booking summary");
  drawWrapped(data.binsText || "(none provided)", { size: 10, bold: true });
  y -= 6;
  drawWrapped(data.pricingText || "Pricing not provided.", { size: 10 });

  // Keep verification together and away from the previous pricing lines.
  if (y < 190) addPage(false);
  section("Verification");
  drawWrapped("This unique SHA-256 verification hash is generated from the booking and acceptance details recorded in this certificate.", { size: 9, color: BRAND.grey });
  y -= 6;
  drawWrapped(verificationHash, { size: 8, bold: true, color: BRAND.red });

  // Start the legal terms with enough breathing room so its title never overlaps the hash.
  if (y < 180) addPage(false);
  section("Terms agreed to");
  drawWrapped(termsBody, { size: 9, lineGap: 12 });

  ensureSpace(70);
  y -= 12;
  page.drawRectangle({ x: margin, y: y - 44, width: contentWidth, height: 44, color: BRAND.black });
  page.drawText("DIRTY BINS. SORTED.", { x: margin + 16, y: y - 19, size: 16, font: bold, color: BRAND.yellow });
  page.drawText("Thank you for choosing Ni Bin Guy.", { x: margin + 16, y: y - 34, size: 9, font: regular, color: BRAND.white });

  drawFooter();

  const pdfBytes = await pdfDoc.save();
  const filename = `Ni-Bin-Guy-Terms-Acceptance-${safeFilePart(data.name || data.email)}.pdf`;
  return {
    filename,
    content: Buffer.from(pdfBytes).toString("base64"),
    contentType: "application/pdf",
  };
}

module.exports = {
  buildTermsAcceptancePdfAttachment,
  DEFAULT_TERMS_BODY,
};
