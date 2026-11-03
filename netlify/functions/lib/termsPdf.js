const crypto = require("crypto");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const fs = require("node:fs");
const path = require("node:path");

const TERMS_DOC = require("../../../src/data/bookingTerms.json");
const DEFAULT_TERMS_BODY = TERMS_DOC.body;
const { fillPreparedTermsMaster } = require("./preparedTermsPdf");

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
      if (font.widthOfTextAtSize(test, fontSize) <= maxWidth) {
        line = test;
        continue;
      }

      if (line) {
        lines.push(line);
        line = "";
      }

      if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
        line = word;
        continue;
      }

      let chunk = "";
      for (const char of word) {
        const next = chunk + char;
        if (font.widthOfTextAtSize(next, fontSize) <= maxWidth) chunk = next;
        else {
          if (chunk) lines.push(chunk);
          chunk = char;
        }
      }
      line = chunk;
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

// The exact existing NI Bin Guy brand image is packed into the functions
// that generate signed agreements. Never issue a live HTTP request while
// building a booking certificate. Memoize across warm function invocations.
let bundledLogoBytes;
function getBundledLogoBytes() {
  if (bundledLogoBytes !== undefined) return bundledLogoBytes;
  const candidates = [
    path.resolve(process.cwd(), "public/logo.png"),
    path.resolve(__dirname, "../../../public/logo.png"),
    path.resolve(__dirname, "public/logo.png"),
  ];
  for (const filename of candidates) {
    try {
      const bytes = fs.readFileSync(filename);
      if (bytes.length > 8 &&
          bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        bundledLogoBytes = bytes;
        return bytes;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn("Local terms logo unavailable:", error?.code || "read_error");
      }
    }
  }
  bundledLogoBytes = null; // Fallback: retain a complete text-only agreement.
  return null;
}

async function tryEmbedLogo(pdfDoc) {
  try {
    const bytes = getBundledLogoBytes();
    return bytes ? await pdfDoc.embedPng(bytes) : null;
  } catch (_) {
    return null;
  }
}

async function buildTermsAcceptancePdfAttachmentLegacy(data) {
  const termsBody = data.termsBody || DEFAULT_TERMS_BODY;
  const verificationHash = data.verificationHash || buildHash({ ...data, termsBody });

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
    const topGap = 22;
    const barHeight = 28;
    const bottomGap = 18;
    ensureSpace(topGap + barHeight + bottomGap + 8);
    y -= topGap;
    const barBottom = y - barHeight;
    page.drawRectangle({ x: margin, y: barBottom, width: contentWidth, height: barHeight, color: BRAND.black });
    page.drawRectangle({ x: margin, y: barBottom, width: 7, height: barHeight, color: BRAND.yellow });
    page.drawText(pdfSafe(title).toUpperCase(), { x: margin + 16, y: barBottom + 9, size: 12, font: bold, color: BRAND.white });
    y = barBottom - bottomGap;
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

  if (y < 220) addPage(false);
  section("Verification");
  drawWrapped("This unique SHA-256 verification hash is generated from the booking and acceptance details recorded in this certificate.", { size: 9, color: BRAND.grey });
  y -= 10;
  const hashChunks = verificationHash.match(/.{1,32}/g) || [verificationHash];
  for (const hashChunk of hashChunks) {
    drawWrapped(hashChunk, { size: 8, bold: true, color: BRAND.red });
  }
  y -= 8;

  if (y < 210) addPage(false);
  section("Terms agreed to");
  drawWrapped(termsBody, { size: 9, lineGap: 12 });

  ensureSpace(82);
  y -= 16;
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

// The fixed, branded September 2026 master is produced once at build time.
 // Only personal details and the hash are stamped per request. If an unusual
 // booking cannot fit the reserved spaces, or a stale/missing template appears,
 // retain the complete original generator rather than lose any legal text.
async function buildTermsAcceptancePdfAttachment(data) {
  const actualTerms = data.termsBody || DEFAULT_TERMS_BODY;
  if (actualTerms !== DEFAULT_TERMS_BODY ||
      (data.termsVersion && data.termsVersion !== TERMS_DOC.version)) {
    return buildTermsAcceptancePdfAttachmentLegacy(data);
  }
  try {
    const verifiedHash = data.verificationHash ||
      buildHash({ ...data, termsBody: actualTerms });
    const filled = await fillPreparedTermsMaster(data, verifiedHash);
    if (filled) return filled;
  } catch (error) {
    console.warn("Prepared Terms PDF unavailable; using complete generator",
      error?.message || "unknown");
  }
  return buildTermsAcceptancePdfAttachmentLegacy(data);
}

module.exports = {
  buildTermsAcceptancePdfAttachment,
  buildTermsAcceptancePdfAttachmentLegacy,
  buildHash,
  getBundledLogoBytes,
  DEFAULT_TERMS_BODY,
};
