const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("MET forecast codes choose the correct N64 weather worlds", async () => {
  const { arcadeWeatherMode, isBangorDay, parseBangorForecast } =
    await import("../netlify/functions/arcadeWeather.mjs");
  for (const [source, result] of [
    ["clearsky_day", "sunny"], ["fair_night", "sunny"],
    ["partlycloudy_day", "cloudy"], ["lightrainshowers_night", "rain"],
    ["rainandthunder", "storm"], ["heavysnow", "snow"],
    ["sleet", "snow"], ["fog", "fog"]
  ]) assert.equal(arcadeWeatherMode(source), result);
  assert.equal(isBangorDay(new Date("2026-11-01T12:00:00Z")), true);
  assert.equal(isBangorDay(new Date("2026-11-01T20:00:00Z")), false);
  assert.equal(isBangorDay(new Date("2026-07-01T20:00:00Z")), true);
  const sample = { properties: { timeseries: [
    { time: "2026-11-01T19:00:00Z", data: {
      instant: { details: { air_temperature: 7.3 } },
      next_1_hours: { summary: { symbol_code: "rain" } }
    } }
  ] } };
  const forecast = parseBangorForecast(sample, new Date("2026-11-01T19:15:00Z"));
  assert.equal(forecast.mode, "rain");
  assert.equal(forecast.isNight, true);
  assert.equal(forecast.temperatureC, 7);
  assert.equal(forecast.location, "Bangor & North Down");
});

test("Preview 1 weather is cosmetic, mobile-safe, and booking code is untouched", () => {
  const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  const jsx = read("src/LandingPage.jsx");
  const component = read("src/components/ArcadeWeather.jsx");
  const css = read("src/n64-weather.css");
  assert.match(jsx, /useArcadeWeather\(\)/);
  assert.match(jsx, /<ArcadeWeatherScene /);
  assert.match(jsx, /<Hero weather=\{weather\}/);
  assert.match(jsx, /getPreviewBookingProof/);
  assert.doesNotMatch(jsx, /<SnowCanvas enabled=/);
  assert.match(component, /deploy-preview-77--nibinguy\.netlify\.app/);
  assert.match(component, /\/\.netlify\/functions\/arcadeWeather/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /pointer-events:none/);
  assert.match(read("src/App.jsx"), /n64-weather\.css/);
});
