"use strict";

// Generated branded Terms pages stay unchanged between bookings. The
// personalised certificate is stamped onto two pre-rendered front pages.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const TERMS = require("../../../src/data/bookingTerms.json");

const REVISION = "prepared-terms-v2-annual-summary";
const MASTER_RELATIVE = "netlify/functions/lib/assets/terms-september-2026-master.pdf";
const FINGERPRINT = "Ni Bin Guy prepared Terms " +
  crypto.createHash("sha256").update(JSON.stringify({
    revision: REVISION, version: TERMS.version, body: TERMS.body,
  })).digest("hex");

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const COLOURS = {
  black: rgb(0.02, 0.02, 0.02),
  yellow: rgb(1, 0.83, 0),
  white: rgb(1, 1, 1),
  ink: rgb(0.08, 0.08, 0.08),
  grey: rgb(0.42, 0.42, 0.42),
  red: rgb(0.77, 0.07, 0.16),
  pale: rgb(0.96, 0.96, 0.96),
};

function pdfSafe(input) {
  return String(input ?? "")
    .replace(/£/g, "GBP ")
    .replace(/•/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function splitText(text, font, fontSize, width) {
  const result = [];
  for (const paragraph of pdfSafe(text).split(/\r?\n/)) {
    if (!paragraph.trim()) {
      result.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= width) {
        line = candidate;
        continue;
      }
      if (line) result.push(line);
      line = "";
      if (font.widthOfTextAtSize(word, fontSize) <= width) {
        line = word;
        continue;
      }
      let piece = "";
      for (const char of word) {
        if (font.widthOfTextAtSize(piece + char, fontSize) <= width) piece += char;
        else {
          if (piece) result.push(piece);
          piece = char;
        }
      }
      line = piece;
    }
    if (line) result.push(line);
  }
  return result;
}

function text(page, value, x, y, font, size, colour = COLOURS.ink) {
  page.drawText(pdfSafe(value), { x, y, font, size, color: colour });
}
function section(page, title, y, bold) {
  page.drawRectangle({
    x: MARGIN, y, width: CONTENT_WIDTH, height: 28, color: COLOURS.black,
  });
  page.drawRectangle({ x: MARGIN, y, width: 7, height: 28, color: COLOURS.yellow });
  text(page, title, MARGIN + 16, y + 9, bold, 12, COLOURS.white);
}
function header(page, regular, bold, logo, isCover = false) {
  const h = isCover ? 150 : 74;
  page.drawRectangle({
    x: 0, y: PAGE_HEIGHT - h, width: PAGE_WIDTH, height: h, color: COLOURS.black,
  });
  page.drawRectangle({
    x: 0, y: PAGE_HEIGHT - h - 6, width: PAGE_WIDTH, height: 6, color: COLOURS.yellow,
  });
  if (logo) {
    const drawH = isCover ? 62 : 38;
    page.drawImage(logo, {
      x: MARGIN, y: PAGE_HEIGHT - drawH - (isCover ? 24 : 18),
      width: drawH * logo.width / logo.height, height: drawH,
    });
  } else {
    text(page, "NI BIN GUY", MARGIN, PAGE_HEIGHT - (isCover ? 60 : 44),
      bold, isCover ? 24 : 17, COLOURS.white);
    text(page, "NO MORE DIRTY BINS", MARGIN, PAGE_HEIGHT - (isCover ? 80 : 60),
      bold, isCover ? 10 : 8, COLOURS.red);
  }
  if (isCover) {
    text(page, "TERMS & CONDITIONS", MARGIN, PAGE_HEIGHT - 104,
      bold, 25, COLOURS.white);
    text(page, "ACCEPTANCE CERTIFICATE", MARGIN, PAGE_HEIGHT - 131,
      bold, 21, COLOURS.yellow);
  } else {
    text(page, "NI BIN GUY  |  SEPTEMBER 2026", 270, PAGE_HEIGHT - 44,
      bold, 10, COLOURS.yellow);
  }
}
function footer(page, regular, pageNumber, pagesCount) {
  page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: 34, color: COLOURS.black });
  text(page, "Page " + pageNumber + " of " + pagesCount,
    MARGIN, 13, regular, 8, COLOURS.white);
  text(page, "nibing.uy  |  07555 178484  |  info@nibing.uy",
    180, 13, regular, 8, COLOURS.yellow);
}
function label(page, title, y, bold) {
  text(page, title, MARGIN + 12, y, bold, 9, COLOURS.grey);
}
function createCover(page, regular, bold, logo) {
  header(page, regular, bold, logo, true);
  page.drawRectangle({
    x: MARGIN, y: 614, width: CONTENT_WIDTH, height: 64, color: COLOURS.yellow,
  });
  text(page, "Digitally dated acceptance from the Ni Bin Guy booking form.",
    MARGIN + 18, 630, regular, 9);
  section(page, "ACCEPTANCE DETAILS", 585, bold);
  label(page, "Accepted", 555, bold);
  label(page, "Terms version", 529, bold);
  label(page, "Accepted at", 503, bold);
  label(page, "Agreement wording", 477, bold);
  section(page, "CUSTOMER DETAILS", 400, bold);
  label(page, "Name", 374, bold);
  label(page, "Email", 349, bold);
  label(page, "Phone", 324, bold);
  label(page, "Address", 299, bold);
  label(page, "Booking source", 236, bold);
  section(page, "VERIFICATION", 178, bold);
  text(page, "Unique SHA-256 of the booking, agreed terms and acceptance record.",
    MARGIN + 12, 160, regular, 8, COLOURS.grey);
  label(page, "SHA-256", 143, bold);
}
function createSummary(page, regular, bold, logo) {
  header(page, regular, bold, logo, false);
  section(page, "BOOKING SUMMARY", 693, bold);
  text(page, "Selected bins", MARGIN + 12, 667, bold, 11);
  text(page, "Pricing breakdown", MARGIN + 12, 441, bold, 11);
  // Space below is reserved for a personalised 13-clean cost illustration.
  // Draw the heading only for bookings containing four-weekly plans.
  page.drawRectangle({
    x: MARGIN, y: 77, width: CONTENT_WIDTH, height: 51, color: COLOURS.black,
  });
  text(page, "DIRTY BINS. SORTED.", MARGIN + 16, 107,
    bold, 16, COLOURS.yellow);
  text(page, "Thank you for choosing Ni Bin Guy.", MARGIN + 16, 90,
    regular, 9, COLOURS.white);
}
function createTermsPages(pdf, regular, bold, logo) {
  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  header(page, regular, bold, logo, false);
  section(page, "TERMS AGREED TO", 693, bold);
  let y = 670;
  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    header(page, regular, bold, logo, false);
    y = 726;
  };
  for (const paragraph of TERMS.body.split(/\r?\n/)) {
    if (!paragraph.trim()) {
      y -= 7;
      continue;
    }
    const heading = /^\d+\)\s/.test(paragraph.trim());
    if (heading) y -= 7;
    const size = heading ? 10 : 9;
    const font = heading ? bold : regular;
    for (const line of splitText(paragraph, font, size, CONTENT_WIDTH - 8)) {
      if (y < 66) newPage();
      if (line) text(page, line, MARGIN + 4, y, font, size);
      y -= heading ? 15 : 12;
    }
  }
}
async function createPreparedTermsMaster({ logoBytes } = {}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Ni Bin Guy September 2026 Terms Acceptance Master");
  pdf.setAuthor("Ni Bin Guy");
  pdf.setSubject(FINGERPRINT);
  pdf.setKeywords(["September 2026", "Terms of Service", REVISION]);
  pdf.setCreationDate(new Date("2026-09-01T00:00:00Z"));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo = null;
  if (logoBytes) {
    try { logo = await pdf.embedPng(logoBytes); }
    catch (_) { logo = null; }
  }

  createCover(pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]), regular, bold, logo);
  createSummary(pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]), regular, bold, logo);
  createTermsPages(pdf, regular, bold, logo);
  const pages = pdf.getPages();
  pages.forEach((page, index) => footer(page, regular, index + 1, pages.length));
  return Buffer.from(await pdf.save());
}
let memoMasterBytes;
function loadPreparedMasterBytes() {
  if (memoMasterBytes) return memoMasterBytes;
  const paths = [
    path.resolve(__dirname, "assets/terms-september-2026-master.pdf"),
    path.resolve(process.cwd(), MASTER_RELATIVE),
    path.resolve(process.cwd(), "assets/terms-september-2026-master.pdf"),
  ];
  for (const filename of paths) {
    try {
      const data = fs.readFileSync(filename);
      if (data.subarray(0, 5).toString("ascii") === "%PDF-") {
        memoMasterBytes = data;
        return data;
      }
    } catch (_) {
      // Missing files in local/tests: the caller uses the legacy generator.
    }
  }
  return null;
}
function ukDateTime(iso) {
  try {
    return new Date(iso).toLocaleString("en-GB", {
      timeZone: "Europe/London", year: "numeric",
      month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch (_) { return String(iso || ""); }
}
function safeFilePart(value) {
  const v = String(value || "customer").trim().replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "").slice(0, 40);
  return v || "customer";
}
async function fillPreparedTermsMaster(data, hash, { masterBytes } = {}) {
  const bytes = masterBytes || loadPreparedMasterBytes();
  if (!bytes) return null;
  const pdf = await PDFDocument.load(bytes);
  // Invalidate the master automatically whenever the actual terms change.
  if (pdf.getSubject() !== FINGERPRINT) return null;
  const pages = pdf.getPages();
  if (pages.length < 3 || !/^[a-f0-9]{64}$/i.test(String(hash || ""))) return null;
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const cover = pages[0];
  const summary = pages[1];

  const status = data.termsAccepted ? "ACCEPTANCE RECORDED" : "ACCEPTANCE NOT RECORDED";
  const fields = [
    {page:cover, value:data.termsAccepted ? "Yes" : "No", x:170, y:555, max:1},
    {page:cover, value:data.termsVersion || TERMS.version, x:170, y:529, max:1},
    {page:cover, value:ukDateTime(data.termsTimestamp) + " Europe/London", x:170, y:503, max:1},
    {page:cover, value:data.termsAcceptanceText || "", x:170, y:477, max:3, spacing:12},
    {page:cover, value:data.name || "", x:170, y:374, max:1},
    {page:cover, value:data.email || "", x:170, y:349, max:1},
    {page:cover, value:data.phone || "", x:170, y:324, max:1},
    {page:cover, value:data.address || "", x:170, y:299, max:3, spacing:12},
    {page:cover, value:data.source || "website", x:170, y:236, max:1},
    {page:summary, value:data.binsText || "(none provided)", x:MARGIN+12, y:644,
      max:15, spacing:13, bold:true, size:10, width:CONTENT_WIDTH-24},
    {page:summary, value:data.pricingText || "Pricing not provided.",
      x:MARGIN+12, y:417, max:data.annualBreakdownText ? 9 : 23,
      spacing:13, size:10, width:CONTENT_WIDTH-24},
    ...(data.annualBreakdownText ? [{
      page:summary, value:data.annualBreakdownText,
      x:MARGIN+12, y:246, max:8, spacing:14, size:9.5,
      width:CONTENT_WIDTH-24,
    }] : []),
  ];
  const prepared = fields.map(field => {
    const font = field.bold ? bold : regular;
    const size = field.size || 10;
    const lines = splitText(field.value, font, size, field.width || 380);
    return { ...field, font, size, lines };
  });
  // Unusual oversized addresses, free text or bulk bin orders must never be
  // clipped. The calling function keeps the full legacy generator as fallback.
  if (prepared.some(field => field.lines.length > field.max)) return null;

  text(cover, status, MARGIN + 18, 646, bold, 18);
  if (data.annualBreakdownText) {
    section(summary, "ANNUAL COST BREAKDOWN - 13 CLEANS", 276, bold);
  }
  for (const field of prepared) {
    let y = field.y;
    for (const line of field.lines) {
      if (line) text(field.page, line, field.x, y, field.font, field.size);
      y -= field.spacing || 12;
    }
  }
  text(cover, String(hash).slice(0, 32), 170, 143, bold, 8, COLOURS.red);
  text(cover, String(hash).slice(32), 170, 130, bold, 8, COLOURS.red);
  pdf.setTitle("Ni Bin Guy Terms Acceptance Certificate");
  pdf.setAuthor("Ni Bin Guy");
  pdf.setSubject("Customer digital acceptance of terms and conditions");
  pdf.setKeywords(["Ni Bin Guy", "Terms", "Acceptance", "Booking"]);
  pdf.setCreationDate(new Date());
  const filename = "Ni-Bin-Guy-Terms-Acceptance-" +
    safeFilePart(data.name || data.email) + ".pdf";
  return {
    filename,
    content: Buffer.from(await pdf.save()).toString("base64"),
    contentType: "application/pdf",
  };
}

module.exports = {
  REVISION, MASTER_RELATIVE, FINGERPRINT,
  createPreparedTermsMaster, loadPreparedMasterBytes, fillPreparedTermsMaster,
};
