const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("original N64 sunny scenery and three clouds are restored", () => {
  const landing = read("src/LandingPage.jsx");
  const app = read("src/App.jsx");
  const theme = read("src/n64-theme.css");
  const square = read("src/n64-square.css");
  assert.match(landing, /<section className="n64-hero n64-hero-layout-v2"/);
  for (const position of ["one", "two", "three"]) {
    assert.match(landing, new RegExp('<div className="n64-cloud n64-cloud--' + position + '" aria-hidden="true" />'));
  }
  assert.match(theme, /radial-gradient\(circle at 84% 13%/);
  assert.match(theme, /#61bbfa/);
  assert.match(square, /#main-content\.n64-world \.n64-cloud/);
  assert.match(app, /\.\/n64-theme\.css/);
  assert.match(app, /\.\/n64-square\.css/);
});

test("no weather menu, forecast requests, rain, night, fog or other weather variants remain", () => {
  const landing = read("src/LandingPage.jsx");
  const app = read("src/App.jsx");
  assert.doesNotMatch(landing, /ArcadeWeather|useArcadeWeather|N64LowPolyCloud|data-weather=|data-night=|weather\.isPreview|n64-weather-testing/);
  assert.doesNotMatch(app, /n64-weather\.css|Background weather data|met\.no/);
  for (const file of [
    "src/components/ArcadeWeather.jsx",
    "src/n64-weather.css",
    "netlify/functions/arcadeWeather.mjs"
  ]) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file + " should not be deployed");
  }
});

test("booking, postcode checker, customer portal and leaderboard remain", () => {
  const landing = read("src/LandingPage.jsx");
  const app = read("src/App.jsx");
  assert.match(landing, /getPreviewBookingProof/);
  assert.match(landing, /<BookingForm /);
  assert.match(landing, /<Hero onBook=\{openBooking\}/);
  assert.match(landing, /setShowCoverageChecker/);
  assert.match(app, /CustomerPortalLoader/);
  assert.match(app, /ArcadeLeaderboard/);
});
