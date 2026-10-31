"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const {normaliseUkBookingPhone}=require(
  "../netlify/functions/lib/ukBookingPhone");

test("UK landlines and mobiles normalise to exactly 11 national digits",()=>{
  for(const [input,expected] of [
    ["028 9146 9191","02891469191"],
    ["02891469191","02891469191"],
    ["+44 28 9146 9191","02891469191"],
    ["0044 28 9146 9191","02891469191"],
    ["07700 900123","07700900123"],
    ["+447700900123","07700900123"],
    ["020 7946 0958","02079460958"],
  ]) assert.equal(normaliseUkBookingPhone(input),expected,input);
});

test("postcodes, alphabetic strings, missing or malformed numbers cannot be accepted",()=>{
  for(const invalid of [
    "BT20 5NF","BT19 7LA","postcode","not provided","0289 123",
    "0790012","12345678901","00000000000","0123456789012",
    "abc02891469191","02891469191 extension 2","99999999999",
    "",null,undefined,
  ]) assert.equal(normaliseUkBookingPhone(invalid),null,String(invalid));
});

test("web booking form validates before claiming the reference or posting any data",()=>{
  const code=fs.readFileSync(path.join(root,"src/LandingPage.jsx"),"utf8");
  const start=code.indexOf("function BookingForm(");
  const end=code.indexOf("function ContactForm(",start);
  assert.ok(start>0&&end>start);
  const form=code.slice(start,end);
  assert.match(code,/function normaliseBookingContactNumber\(input\)/);
  assert.match(form,/const validContactNumber=normaliseBookingContactNumber\(phone\)/);
  assert.match(form,/A postcode cannot be used as a phone number/);
  assert.match(form,/phone: validContactNumber/);
  assert.ok(form.indexOf("const validContactNumber=")<
    form.indexOf("emailSubmissionInFlightRef.current = true"));
  assert.match(form,/autoComplete="tel"/);
});

test("booking API rejects invalid contact numbers before email, XP, or Squeegee dispatch",()=>{
  const code=fs.readFileSync(path.join(root,
    "netlify/functions/sendBookingEmail.js"),"utf8");
  assert.match(code,/normaliseUkBookingPhone\(rawPhone\)/);
  assert.match(code,/statusCode:422/);
  assert.match(code,/reason:"invalid_booking_phone"/);
  assert.match(code,/payload.phone=phone/);
  assert.ok(code.indexOf("const phone=normaliseUkBookingPhone(rawPhone)")<
    code.indexOf("await claimBookingSubmission"));
  assert.ok(code.indexOf("const phone=normaliseUkBookingPhone(rawPhone)")<
    code.indexOf("await dispatchAcceptedBooking"));
});
