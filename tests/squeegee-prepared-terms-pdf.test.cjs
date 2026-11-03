"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {PDFDocument}=require("pdf-lib");
const TERMS=require("../src/data/bookingTerms.json");
const {createPreparedTermsMaster,fillPreparedTermsMaster,FINGERPRINT,
  MASTER_RELATIVE}=require("../netlify/functions/lib/preparedTermsPdf");
const {buildHash,getBundledLogoBytes,buildTermsAcceptancePdfAttachment,
  buildTermsAcceptancePdfAttachmentLegacy}=require("../netlify/functions/lib/termsPdf");

const sample={
  name:"Example Customer",email:"sample@example.org",
  phone:"02890000000",address:"17 Example Road, Bangor BT20 4AA",
  binsText:"1 x Black Bin (4 Weekly)\n1 x Brown Bin (4 Weekly)",
  pricingText:"Pricing:\n1 x Black: GBP 5\n1 x Brown: GBP 5\n\nSubtotal: GBP 10\nTotal: GBP 10\n\nDiscount Code: None",
  termsAccepted:true,termsVersion:TERMS.version,
  termsAcceptanceText:"I confirm I've read and agree to the Ni Bin Guy Terms of Service (vSeptember 2026), including the leaderboard acknowledgement.",
  termsTimestamp:"2026-11-03T15:00:00.000Z",
  termsBody:TERMS.body,source:"website",
};

test("prepared master contains unmodified canonical September terms and no customer details",async()=>{
  const master=await createPreparedTermsMaster({logoBytes:getBundledLogoBytes()});
  assert.equal(master.subarray(0,5).toString("ascii"),"%PDF-");
  const doc=await PDFDocument.load(master);
  assert.equal(TERMS.version,"September 2026");
  assert.equal(doc.getSubject(),FINGERPRINT);
  assert.match(doc.getTitle(),/September 2026 Terms Acceptance Master/);
  assert.ok(doc.getPageCount()>=3,"two certificate pages plus Terms pages");
  assert.ok(master.length>10000);
  assert.match(MASTER_RELATIVE,/terms-september-2026-master\.pdf$/);
});

test("prepared certificate includes all pages, digitally recorded hash and correct attachment metadata",async()=>{
  const master=await createPreparedTermsMaster({logoBytes:getBundledLogoBytes()});
  const hash=buildHash(sample);
  assert.match(hash,/^[a-f0-9]{64}$/);
  const attachment=await fillPreparedTermsMaster(sample,hash,{masterBytes:master});
  assert.ok(attachment,"normal customer details should fit on prepared pages");
  assert.match(attachment.filename,/Ni-Bin-Guy-Terms-Acceptance-Example-Customer\.pdf$/);
  assert.equal(attachment.contentType,"application/pdf");
  const doc=await PDFDocument.load(Buffer.from(attachment.content,"base64"));
  assert.equal(doc.getPageCount(),(await PDFDocument.load(master)).getPageCount());
  assert.equal(doc.getTitle(),"Ni Bin Guy Terms Acceptance Certificate");
  assert.equal(doc.getSubject(),"Customer digital acceptance of terms and conditions");
  const other={...sample,name:"Other Customer",email:"different@example.org"};
  const extra=await fillPreparedTermsMaster(other,buildHash(other),{masterBytes:master});
  assert.ok(extra);
  assert.notEqual(attachment.content,extra.content,"each customer must receive unique certificate bytes");
});

test("oversized booking details and mismatched/stale master never silently truncate or change agreed terms",async()=>{
  const master=await createPreparedTermsMaster({logoBytes:getBundledLogoBytes()});
  const tooLong={...sample,
    address:"A very long name ".repeat(120)+" BT20 4AA",
    pricingText:"Long price line\n".repeat(100),
  };
  assert.equal(await fillPreparedTermsMaster(tooLong,buildHash(tooLong),{masterBytes:master}),null);
  const stale=await PDFDocument.load(master);
  stale.setSubject("obsolete master");
  assert.equal(await fillPreparedTermsMaster(sample,buildHash(sample),{
    masterBytes:await stale.save(),
  }),null);
  const custom={...sample,termsBody:"Customer-specific noncanonical Terms"};
  const legacy=await buildTermsAcceptancePdfAttachment(custom);
  assert.ok(legacy.content,"legacy generator must handle nonstandard legal text");
  assert.equal(legacy.contentType,"application/pdf");
});

test("normal booking attachment and legacy generator retain the same accepted terms PDF contract",async()=>{
  const expected=await buildTermsAcceptancePdfAttachmentLegacy(sample);
  const current=await buildTermsAcceptancePdfAttachment(sample);
  assert.match(expected.filename,/Example-Customer/);
  assert.equal(current.filename,expected.filename);
  assert.equal(current.contentType,expected.contentType);
  const doc=await PDFDocument.load(Buffer.from(current.content,"base64"));
  assert.ok(doc.getPageCount()>=3);
  assert.equal(doc.getTitle(),"Ni Bin Guy Terms Acceptance Certificate");
});

test("preview build produces the master before vite, and bundles it for every PDF-producing function",()=>{
  const root=path.resolve(__dirname,"..");
  const pkg=require("../package.json");
  assert.match(pkg.scripts.build,/node scripts\/buildPreparedTermsPdf\.cjs && vite build/);
  const cfg=fs.readFileSync(path.join(root,"netlify.toml"),"utf8");
  for(const name of ["sendBookingEmail","sendStreetBookingEmail",
    "sendStreetBookingEmailV2","sendAutomaticBookingConfirmation",
    "sendTosReceipt","sheilaTermsAcceptance",
    "evelynTermsAcceptance","grahamTermsAcceptance"]){
    assert.ok(cfg.includes("[functions."+name+"]\n  included_files = "+
      '["public/logo.png", "netlify/functions/lib/assets/terms-september-2026-master.pdf"]'),
      "Master Terms PDF must be bundled in "+name);
  }
  const code=fs.readFileSync(path.join(root,"netlify/functions/lib/termsPdf.js"),"utf8");
  assert.match(code,/actualTerms !== DEFAULT_TERMS_BODY/);
  assert.match(code,/data\.termsVersion !== TERMS_DOC\.version/);
  assert.match(code,/return buildTermsAcceptancePdfAttachmentLegacy\(data\)/);
  assert.match(code,/const filled = await fillPreparedTermsMaster/);
});
