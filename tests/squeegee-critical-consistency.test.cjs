"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const terms=require("../src/data/bookingTerms.json");
const {DEFAULT_TERMS_BODY}=require("../netlify/functions/lib/termsPdf");
const {PLANS,verifyAndPriceBooking}=require("../netlify/functions/lib/squeegeeBookingPricing");
const source=(p)=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");

test("September 2026 terms and leaderboard acknowledgement appear identically on the forms and in the PDF",()=>{
  assert.equal(terms.version,"September 2026");
  assert.equal(DEFAULT_TERMS_BODY,terms.body);
  assert.match(terms.body,/Customer Rewards & Public Leaderboard/);
  assert.match(terms.body,/first name, town, XP and leaderboard position/);
  assert.match(terms.body,/does NOT itself grant permission to publish your name/);
  for(const file of ["src/LandingPage.jsx","src/pages/StreetBookingPage.jsx"]){
    assert.match(source(file),/BOOKING_TERMS\.body/);
    assert.match(source(file),/BOOKING_TERMS\.version/);
  }
  for(const file of ["netlify/functions/sendBookingEmail.js","netlify/functions/sendStreetBookingEmail.js",
   "netlify/functions/sendStreetBookingEmailV2.js","netlify/functions/sendAutomaticBookingConfirmation.js"]){
    assert.match(source(file),/const TERMS_BODY = BOOKING_TERMS\.body/);
    assert.match(source(file),/TERMS_VERSION_DEFAULT = BOOKING_TERMS\.version/);
  }
});
test("GBP45 is the one-off price for both 660L and 1100L commercial bins",()=>{
  assert.equal(PLANS.comm_gt660_oneoff.price,45);
  for(const file of ["src/LandingPage.jsx","src/pages/StreetBookingPage.jsx"]){
    assert.match(source(file),/comm_gt660_oneoff", label: "Commercial 660L\+ One-Off", price: 45/);
    assert.match(source(file),/comm_gt660_4w", label: "Commercial 660L\+ 4 Weekly", price: 15/);
  }
  for(const sizeLitres of [660,1100]){
    const bins=[{type:"Black Bin",count:1,planId:"comm_gt660_oneoff",sizeLitres}];
    const initial=verifyAndPriceBooking(bins,"",null);
    assert.equal(initial.canonical.total,45);
    const verified=verifyAndPriceBooking(bins,"",initial.canonical);
    assert.equal(verified.ok,true);
    assert.equal(verified.canonical.total,45);
  }
});
test("verified completed bins never include estimated daily progress or animation increments",()=>{
  const stats=source("src/data/statsPlan.js"),hero=source("src/LandingPage.jsx");
  assert.match(stats,/totalBinsCleaned:TOTAL_COMPLETED_BINS/);
  assert.match(stats,/PRE_SQUEEGEE_COMPLETED_BINS = VERIFIED_COMPLETED_SERVICES\.beforeSqueegeeBins/);
  assert.doesNotMatch(hero,/Squeegee records to|Including our new round/);
  assert.doesNotMatch(stats,/computeEstimatedRouteTotals|Math\.floor\(today\.bins/);
  assert.doesNotMatch(hero,/MAX_ADDS|sessionAddsRef/);
});
test("preview contact uses signed proof without loading production recaptcha badge",()=>{
  assert.match(source("src/main.jsx"),/isNetlifyPreview/);
  assert.match(source("src/LandingPage.jsx"),/previewProof = await getPreviewBookingProof\(\)/);
  assert.match(source("netlify/functions/sendContactEmail.js"),/previewChallenge\.verifyPreviewBooking/);
});
test("no booking is accepted without a signed terms PDF for customer and owner",()=>{
  const code=source("netlify/functions/sendBookingEmail.js");
  assert.ok(code.indexOf("if (!termsPdfAttachment)")<code.indexOf("const claim = await claimBookingSubmission"));
  assert.ok(code.indexOf("ownerCertificate.storeCustomerCertificate")<code.indexOf("const claim = await claimBookingSubmission"));
  assert.match(code,/statusCode: 424/);
});
