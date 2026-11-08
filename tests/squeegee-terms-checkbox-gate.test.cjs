"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const homepage = read("src/LandingPage.jsx");
const street = read("src/pages/StreetBookingPage.jsx");
const homeForm = homepage.slice(
  homepage.indexOf("function BookingForm("),
  homepage.indexOf("function ContactForm(")
);

function verifyTermsModal(source) {
  const modal = source.slice(
    source.indexOf("function TermsModal("),
    source.indexOf("function BookingForm(") > 0
      ? source.indexOf("function BookingForm(")
      : source.indexOf("export default function StreetBookingPage()")
  );
  assert.match(modal, /setScrolledToEnd\(false\)/);
  assert.match(modal, /el\.scrollTop = 0/);
  assert.match(modal, /disabled=\{!scrolledToEnd\}/);
  assert.match(modal, /Confirm &amp; Agree/);
}

test("homepage only unlocks its terms checkbox AFTER modal confirmation", () => {
  verifyTermsModal(homepage);
  assert.match(homeForm, /const \[termsConfirmed, setTermsConfirmed\] = useState\(false\)/);
  assert.match(homeForm, /const canToggleAgree = termsConfirmed/);
  assert.match(homeForm, /onClick=\{\(\) => setShowTerms\(true\)\}/);
  assert.match(homeForm, /checked=\{agreeToTerms\}\s*disabled=\{!canToggleAgree\}/);
  assert.match(homeForm, /onConfirm=\{\(\) => \{[\s\S]*?setTermsConfirmed\(true\);\s*setAgreeToTerms\(true\)/);
  assert.match(homeForm, /validateArcadeBookingFields\(\{/);
  const formValidation=read("src/bookingFormValidation.mjs");
  assert.match(formValidation, /if\(!termsConfirmed\|\|!agreeToTerms\)/);
  assert.match(homeForm, /disabled=\{!termsConfirmed \|\| !agreeToTerms \|\| isEmailSubmitting/);
  assert.doesNotMatch(homeForm, /setTermsConfirmed\(true\)[\s\S]{0,100}setShowTerms\(true\)/);
  assert.equal((homeForm.match(/setTermsConfirmed\(true\)/g) || []).length, 1);
  assert.match(homeForm, /\{showTerms && \(/);
});

test("street booking cannot check or submit terms by opening and closing the popup", () => {
  verifyTermsModal(street);
  assert.match(street, /const \[termsConfirmed, setTermsConfirmed\] = useState\(false\)/);
  assert.match(street, /onClick=\{\(\) => setTermsOpen\(true\)\}/);
  assert.match(street, /checked=\{termsAccepted\} disabled=\{!termsConfirmed\}/);
  assert.match(street, /onConfirm=\{\(\) => \{\s*setTermsConfirmed\(true\);\s*setTermsAccepted\(true\)/);
  assert.match(street, /if \(!termsConfirmed \|\| !termsAccepted\)/);
  assert.match(street, /disabled=\{submitting \|\| !termsConfirmed \|\| !termsAccepted\}/);
  assert.match(street, /setTermsConfirmed\(false\)/); // next customer resets the gate
  assert.equal((street.match(/setTermsConfirmed\(true\)/g) || []).length, 1);
  assert.match(street, /\{termsOpen && \(/);
});

test("both forms retain the single approved September 2026 terms document", () => {
  const terms = JSON.parse(read("src/data/bookingTerms.json"));
  assert.equal(terms.version, "September 2026");
  assert.match(terms.body, /Customer Rewards & Public Leaderboard/);
  assert.match(homepage, /const TERMS_BODY = BOOKING_TERMS\.body/);
  assert.match(street, /const TERMS_BODY = BOOKING_TERMS\.body/);
});
