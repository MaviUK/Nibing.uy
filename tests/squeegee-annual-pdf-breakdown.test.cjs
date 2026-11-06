"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {PDFDocument}=require("pdf-lib");
const {annualBookingBreakdown,CLEANS_PER_YEAR}=
  require("../netlify/functions/lib/annualBookingBreakdown");
const {createPreparedTermsMaster,fillPreparedTermsMaster}=
  require("../netlify/functions/lib/preparedTermsPdf");
const {buildHash,buildTermsAcceptancePdfAttachment,
  getBundledLogoBytes}=require("../netlify/functions/lib/termsPdf");
const TERMS=require("../src/data/bookingTerms.json");

function row(type,planId,count,unitPrice,lineTotal,extra={}){
  return {type,planId,count,unitPrice,lineTotal,...extra};
}
const black=row("Black Bin","domestic_4w",1,5,5);
const blue=row("Blue Bin","domestic_4w",1,5,5);

test("annual PDF breakdown: screenshot's Black and Blue bins total GBP 130 over 13 cleans",()=>{
  assert.equal(CLEANS_PER_YEAR,13);
  const text=annualBookingBreakdown({lines:[black,blue]});
  assert.match(text,/13 cleans across 52 weeks/);
  assert.match(text,/1 x Black Bin: GBP 5 x 13 = GBP 65/);
  assert.match(text,/1 x Blue Bin: GBP 5 x 13 = GBP 65/);
  assert.match(text,/Per 4-weekly visit: GBP 10/);
  assert.match(text,/TOTAL FOR 13 CLEANS: GBP 130/);
  assert.match(text,/not payable upfront/);
});

test("one-off only has no annual projection; mixed bookings exclude one-offs",()=>{
  assert.equal(annualBookingBreakdown({lines:[
    row("Black Bin","domestic_oneoff",1,15,15),
    row("Blue Bin","comm_gt660_oneoff",1,45,45),
  ]}),"");
  const mixed=annualBookingBreakdown({lines:[
    black,
    row("Brown Bin","domestic_oneoff",1,15,15),
  ]});
  assert.match(mixed,/TOTAL FOR 13 CLEANS: GBP 65/);
  assert.doesNotMatch(mixed,/Brown Bin/);
  assert.match(mixed,/One-offs excluded/);
});

test("large commercial recurring bins, quantities, discounts use booked per-clean charge",()=>{
  const text=annualBookingBreakdown({lines:[
    row("Black Bin","comm_gt660_4w",2,15,30,{sizeLitres:1100}),
    row("Green Bin","domestic_4w",7,5,30,{freeCount:1}),
  ]});
  assert.match(text,/2 x Black Bin \(1100L\): GBP 30 x 13 = GBP 390/);
  assert.match(text,/7 x Green Bin: GBP 30 x 13 = GBP 390/);
  assert.match(text,/TOTAL FOR 13 CLEANS: GBP 780/);
  assert.doesNotMatch(text,/GBP 845/);
});

test("no annual pricing is invented if posted price rows are absent or invalid",()=>{
  assert.equal(annualBookingBreakdown(null),"");
  assert.equal(annualBookingBreakdown({lines:[]}),"");
  assert.equal(annualBookingBreakdown({lines:[row("Black Bin","domestic_4w",1,5,NaN)]}),"");
  assert.equal(annualBookingBreakdown({lines:[row("Black Bin","domestic_4w",0,5,0)]}),"");
});

test("annual breakdown is part of the customer's signed SHA256 and personal PDF",async()=>{
  const annual=annualBookingBreakdown({lines:[black,blue]});
  const fixture={
    name:"Test Customer",email:"test@example.org",phone:"02890000000",
    address:"123 Test Road, Bangor BT20 4AA",
    binsText:"1 x Black Bin (plan: domestic_4w)\n1 x Blue Bin (plan: domestic_4w)",
    pricingText:"Pricing:\n1x Black - 4 Weekly @ GBP 5 = GBP 5\n1x Blue - 4 Weekly @ GBP 5 = GBP 5\n\nSubtotal: GBP 10\nTotal: GBP 10\n\nDiscount Code: None",
    annualBreakdownText:annual,termsAccepted:true,termsVersion:TERMS.version,
    termsAcceptanceText:"I confirm I agree to the September 2026 terms",
    termsTimestamp:"2026-11-03T16:00:00.000Z",termsBody:TERMS.body,source:"website",
  };
  const master=await createPreparedTermsMaster({logoBytes:getBundledLogoBytes()});
  const cert=await fillPreparedTermsMaster(fixture,buildHash(fixture),{masterBytes:master});
  assert.ok(cert,"two-bin customer should remain on fast prebuilt PDF path");
  const pdf=await PDFDocument.load(Buffer.from(cert.content,"base64"));
  assert.equal(pdf.getPageCount(),(await PDFDocument.load(master)).getPageCount());
  assert.equal(pdf.getPageCount(),4);
  assert.notEqual(buildHash(fixture),buildHash({...fixture,annualBreakdownText:"Total for 13 cleans: GBP 1"}));
  const customer=await buildTermsAcceptancePdfAttachment(fixture);
  assert.ok(customer.content);
  assert.equal(customer.contentType,"application/pdf");
});

test("annual summary is also available in the original full-page fallback",async()=>{
  const fixture={
    name:"Big Order",email:"test@example.org",phone:"02890000000",
    address:"Example address BT20 4AA",
    binsText:"1 x Black Bin",pricingText:"Total: GBP 5",
    annualBreakdownText:annualBookingBreakdown({lines:[black]}),
    termsAccepted:true,termsVersion:TERMS.version,
    termsTimestamp:"2026-11-03T16:00:00.000Z",termsBody:"Special nonstandard Terms",
  };
  const pdf=await buildTermsAcceptancePdfAttachment(fixture);
  assert.ok(pdf.content,"legacy path must continue producing annual summary");
  assert.equal(pdf.contentType,"application/pdf");
});
