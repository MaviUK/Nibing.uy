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
  assert.doesNotMatch(component, /deploy-preview-77--nibinguy\.netlify\.app/);
  assert.match(component, /\/\.netlify\/functions\/arcadeWeather/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /pointer-events:none/);
  assert.match(read("src/App.jsx"), /n64-weather\.css/);
});


test("the forecast changes only the scenery and never adds a visible weather widget", () => {
  const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  const component = read("src/components/ArcadeWeather.jsx");
  const landing = read("src/LandingPage.jsx");
  const css = read("src/n64-weather.css");
  const app = read("src/App.jsx");
  assert.match(component, /export function useArcadeWeather\(\)/);
  assert.match(component, /setWeather\(next\)/);
  assert.match(component, /\/\.netlify\/functions\/arcadeWeather/);
  assert.doesNotMatch(component, /testMode|chooseWeather|WEATHER_TEST_OPTIONS|ArcadeWeatherBadge|ArcadeWeatherPreviewBar/);
  assert.match(landing, /<ArcadeWeatherScene mode=\{weather\.mode\} isNight=\{weather\.isNight\} \/>/);
  assert.match(landing, /data-weather=\{weather\.mode\}/);
  assert.doesNotMatch(landing, /ArcadeWeatherBadge|ArcadeWeatherPreviewBar|n64-weather-testing/);
  assert.doesNotMatch(css, /n64-weather-badge|n64-weather-test-/);
  assert.match(app, /MET Norway/);
  assert.match(css, /data-weather="rain"/);
  assert.match(css, /data-weather="snow"/);
  assert.match(css, /data-weather="cloudy"/);
  assert.match(css, /data-weather="fog"/);
});

test("N64 clouds and moon use 3D shaded facets instead of 8-bit silhouettes", () => {
  const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  const component = read("src/components/ArcadeWeather.jsx");
  const landing = read("src/LandingPage.jsx");
  const css = read("src/n64-weather.css");
  assert.match(component, /export function N64LowPolyCloud/);
  assert.match(component, /function N64LowPolySkyOrb/);
  assert.match(component, /N64LowPolySkyOrb isNight=\{isNight\}/);
  assert.match(component, /fill="var\(--n64-cloud-facet\)"/);
  assert.match(component, /fill="var\(--n64-orb-shade\)"/);
  assert.match(landing, /<N64LowPolyCloud className="n64-cloud--one"/);
  assert.match(landing, /<N64LowPolyCloud className="n64-cloud--two"/);
  assert.match(landing, /<N64LowPolyCloud className="n64-cloud--three"/);
  assert.doesNotMatch(landing, /<div className="n64-cloud/);
  assert.doesNotMatch(component, /n64-weather-pixel-moon|n64-weather-extra-clouds"><i/);
  assert.doesNotMatch(css, /n64-weather-pixel-moon/);
  assert.match(css, /\.n64-lowpoly-cloud \{/);
  assert.match(css, /\.n64-weather-orb--moon \{/);
  assert.match(css, /\.n64-weather-orb--sun \{/);
  assert.match(css, /data-night="true".*\.n64-hero \.n64-lead/s);
  assert.match(css, /color:#f8f9f2!important/);
});


test("storm mode shows two subtle lightning flashes every ten seconds, with reduced-motion fallback", () => {
  const css = fs.readFileSync(path.join(__dirname, "..", "src/n64-weather.css"), "utf8");
  const component = fs.readFileSync(path.join(__dirname, "..", "src/components/ArcadeWeather.jsx"), "utf8");
  assert.match(component, /mode === "storm" && <span className="n64-weather-lightning"/);
  assert.match(css, /data-weather="storm"\] \.n64-weather-scene::after/);
  assert.match(css, /animation:n64-storm-sky-flash 10s linear infinite/);
  assert.match(css, /animation:n64-storm-bolt-flash 10s linear infinite/);
  assert.match(css, /@keyframes n64-storm-sky-flash\s*\{/);
  assert.match(css, /@keyframes n64-storm-bolt-flash\s*\{/);
  assert.match(css, /91\.2% \{opacity:\.27;\}/);
  assert.match(css, /94\.8% \{opacity:\.43;\}/);
  assert.match(css, /prefers-reduced-motion:reduce\)\s*\{[\s\S]*?n64-weather-scene::after\s*\{[\s\S]*?animation:none!important/);
});


test("storm lightning has a visible side fork pulsing with the main bolt every ten seconds", () => {
  const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
  const scene = read("src/components/ArcadeWeather.jsx");
  const css = read("src/n64-weather.css");
  assert.match(scene, /mode === "storm" && <span className="n64-weather-lightning" \/>/);
  assert.match(scene, /mode === "storm" && <span className="n64-weather-lightning-fork" \/>/);
  assert.match(css, /data-weather="storm"\] \.n64-weather-lightning-fork\s*\{/);
  assert.match(css, /animation:n64-storm-bolt-flash 10s linear infinite/);
  assert.match(css, /right:calc\(18% - 22px\)/);
  assert.match(css, /right:calc\(10% - 14px\)/);
  assert.match(css, /fork \{[\s\S]*?animation:none!important;[\s\S]*?opacity:\.36!important;/);
  assert.match(css, /@keyframes n64-storm-bolt-flash/);
});
