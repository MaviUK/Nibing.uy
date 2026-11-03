const fs = require("fs");
const path = require("path");

const file = path.join(process.cwd(), "src/pages/StreetBookingPage.jsx");
let src = fs.readFileSync(file, "utf8");

src = src.replace(
  'if (!name.trim() || !email.trim() || !phone.trim() || !address.trim() || bins.some((bin) => !bin.type)) {',
  'if (!name.trim() || !phone.trim() || !address.trim() || bins.some((bin) => !bin.type)) {'
);

src = src.replace(
  'alert("Please complete all fields before submitting.");',
  'alert("Please complete the required fields before submitting.");'
);

src = src.replace(
  'fetch("/.netlify/functions/sendStreetBookingEmail", {',
  'fetch("/.netlify/functions/sendStreetBookingEmailV2", {'
);

src = src.replace(
  'placeholder="Email Address"',
  'placeholder="Email Address (optional)"'
);

src = src.replace(
  'The booking confirmation email and Terms & Conditions Acceptance Certificate have been triggered. No quote',
  'The street booking has been submitted and the Terms & Conditions Acceptance Certificate has been saved. No quote'
);

fs.writeFileSync(file, src);
console.log("Street booking updated: email optional, V2 handler enabled.");
