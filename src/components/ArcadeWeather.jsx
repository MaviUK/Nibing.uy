import React, { useEffect, useState } from "react";

const MODES = new Set(["sunny", "cloudy", "rain", "snow", "fog", "storm"]);
const CACHE_KEY = "nbg_n64_weather_v1", TTL = 12 * 60 * 1000;
const FALLBACK = { mode: "sunny", isNight: false, temperatureC: null, available: false };
const DROPS = Array.from({ length: 62 }, (_, i) => i);
const FLAKES = Array.from({ length: 42 }, (_, i) => i);
const STARS = Array.from({ length: 38 }, (_, i) => i);

function readCache() {
  try {
    const entry = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    if (!MODES.has(entry?.weather?.mode) || !Number.isFinite(entry.savedAt) ||
        Date.now() - entry.savedAt > 2 * 60 * 60 * 1000) return null;
    return entry;
  } catch { return null; }
}

// Preview 1 only: manual style testing, never a real forecast override in production.
const WEATHER_THEME_OPTIONS = [
  ["auto", "↻", "Auto"],
  ["sunny", "☀", "Sun"],
  ["cloudy", "☁", "Cloud"],
  ["rain", "☂", "Rain"],
  ["snow", "❄", "Snow"],
  ["storm", "⚡", "Storm"],
  ["fog", "≋", "Fog"],
  ["night", "☾", "Night"]
];

function isWeatherPreview() {
  return typeof window !== "undefined" &&
    window.location.hostname === "deploy-preview-77--nibinguy.netlify.app";
}
function readThemeChoice() {
  if (!isWeatherPreview()) return "auto";
  const mode = new URLSearchParams(window.location.search).get("weather")?.toLowerCase();
  return WEATHER_THEME_OPTIONS.some(([value]) => value === mode) ? mode : "auto";
}

/** Auto-update a fixed Bangor forecast without tracking customers or asking for GPS. */
export function useArcadeWeather() {
  const [chosenTheme, setChosenTheme] = useState(readThemeChoice);
  const [forecast, setForecast] = useState(() => {
    const saved = readCache();
    return saved ? { ...saved.weather, available: true } : FALLBACK;
  });
  const isPreview = isWeatherPreview();

  const chooseTheme = (next) => {
    if (!isPreview || !WEATHER_THEME_OPTIONS.some(([value]) => value === next)) return;
    setChosenTheme(next);
    // Keep the selected visual theme on refresh, without scrolling to the top.
    try {
      const url = new URL(window.location.href);
      if (next === "auto") url.searchParams.delete("weather");
      else url.searchParams.set("weather", next);
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    } catch { /* The buttons work even when history is unavailable. */ }
  };

  // Only the preview gets a manual override. Auto always uses the true forecast.
  const weather = isPreview && chosenTheme !== "auto"
    ? {
        ...FALLBACK,
        mode: chosenTheme === "night" ? "sunny" : chosenTheme,
        isNight: chosenTheme === "night",
        isPreview, chosenTheme, chooseTheme
      }
    : { ...forecast, isPreview, chosenTheme: "auto", chooseTheme };

  useEffect(() => {
    document.documentElement.dataset.arcadeWeather = weather.mode;
    document.documentElement.dataset.arcadeNight = weather.isNight ? "true" : "false";
    return () => {
      delete document.documentElement.dataset.arcadeWeather;
      delete document.documentElement.dataset.arcadeNight;
    };
  }, [weather.mode, weather.isNight]);

  useEffect(() => {
    let active = true, controller = null;
    const refresh = async () => {
      if (document.hidden || controller) return;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 7500);
      try {
        const response = await fetch("/.netlify/functions/arcadeWeather", { signal: controller.signal });
        if (!response.ok) throw Error("Weather offline");
        const data = await response.json();
        if (!MODES.has(data?.mode) || typeof data.isNight !== "boolean") throw Error("Bad weather result");
        if (!active) return;
        const next = {
          mode: data.mode, isNight: data.isNight,
          temperatureC: Number.isFinite(data.temperatureC) ? data.temperatureC : null,
          available: true, stale: Boolean(data.stale)
        };
        setForecast(next);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ weather: next, savedAt: Date.now() })); } catch {}
      } catch {
        if (active && !readCache()) setForecast(FALLBACK);
      } finally { clearTimeout(timeout); controller = null; }
    };
    const cached = readCache();
    if (!cached || Date.now() - cached.savedAt >= TTL) refresh();
    const interval = setInterval(refresh, TTL);
    const onVisible = () => {
      const saved = readCache();
      if (!document.hidden && (!saved || Date.now() - saved.savedAt >= TTL)) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return weather;
}


/**
 * Original N64-inspired, softly contoured low-poly cloud mesh.
 * The curved silhouette gets its depth from large flat-shaded polygon faces.
 * No external images, no blocky 8-bit clip-paths, no weather text UI.
 */
export function N64LowPolyCloud({ className = "" }) {
  return (
    <svg
      className={["n64-lowpoly-cloud", className].filter(Boolean).join(" ")}
      viewBox="0 0 220 120"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M27 102 C12 102 5 91 8 76 C10 63 24 54 42 55 C45 37 55 28 69 27 C79 24 88 27 96 31 C103 15 118 10 133 13 C151 15 159 30 163 44 C178 40 192 50 197 62 C210 64 218 75 214 88 C211 99 201 103 184 103 Z"
        fill="var(--n64-cloud-base)"
      />
      <path d="M20 81 L42 55 L68 29 L96 31 L106 64 L77 88 L32 90 Z" fill="var(--n64-cloud-light)" />
      <path d="M96 31 L122 15 L137 16 L163 44 L153 68 L106 64 Z" fill="var(--n64-cloud-top)" />
      <path d="M163 44 L187 53 L197 67 L207 79 L191 92 L153 68 Z" fill="var(--n64-cloud-side)" />
      <path d="M32 89 L77 88 L106 64 L153 68 L191 92 L185 103 L29 103 Z" fill="var(--n64-cloud-bottom)" />
      <path d="M46 55 L68 32 L89 34 L105 63 L77 85 L42 82 Z" fill="var(--n64-cloud-facet)" opacity=".72" />
      <path d="M108 63 L134 34 L161 46 L153 69 L127 82 Z" fill="var(--n64-cloud-facet)" opacity=".35" />
    </svg>
  );
}

/* N64-era faceted sky orbs. A crescent at night, a bright sphere by day. */
function N64LowPolySkyOrb({ isNight }) {
  return (
    <svg
      className={"n64-weather-orb " + (isNight ? "n64-weather-orb--moon" : "n64-weather-orb--sun")}
      viewBox="0 0 124 124"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      {isNight ? (
        <>
          <defs>
            <mask id="n64-moon-crescent-mask" maskUnits="userSpaceOnUse">
              <rect x="0" y="0" width="124" height="124" fill="white" />
              <circle cx="91" cy="36" r="53" fill="black" />
            </mask>
          </defs>
          {/* The far side remains visible as a softly shaded low-poly sphere. */}
          <polygon
            points="56,3 84,9 105,24 119,49 116,78 100,103 78,119 49,117 24,104 7,80 5,51 20,25 37,11"
            fill="#304569"
            opacity=".49"
          />
          <g mask="url(#n64-moon-crescent-mask)">
            <polygon
              points="56,3 84,9 105,24 119,49 116,78 100,103 78,119 49,117 24,104 7,80 5,51 20,25 37,11"
              fill="var(--n64-orb-rim)"
            />
            <polygon
              points="55,12 82,16 100,31 110,53 107,78 92,97 76,109 50,109 29,96 15,76 14,53 29,32 45,18"
              fill="var(--n64-orb-base)"
            />
            <polygon points="29,32 45,18 65,14 77,35 46,65 15,64" fill="var(--n64-orb-light)" />
            <polygon points="15,64 46,65 61,82 50,109 29,96 15,76" fill="var(--n64-orb-facet)" />
            <polygon points="46,65 78,61 95,81 76,109 50,109 61,82" fill="var(--n64-orb-shade)" />
            <polygon points="50,109 76,109 99,99 78,118 49,117" fill="var(--n64-orb-bottom)" />
            <polygon points="27,74 36,69 44,76 38,84 29,82" fill="#9ba9b7" opacity=".24" />
            <polygon points="48,94 55,89 61,95 57,102 50,103" fill="#9ba9b7" opacity=".2" />
          </g>
        </>
      ) : (
        <>
          <polygon
            points="56,3 84,9 105,24 119,49 116,78 100,103 78,119 49,117 24,104 7,80 5,51 20,25 37,11"
            fill="var(--n64-orb-rim)"
          />
          <polygon
            points="55,12 82,16 100,31 110,53 107,78 92,97 76,109 50,109 29,96 15,76 14,53 29,32 45,18"
            fill="var(--n64-orb-base)"
          />
          <polygon points="45,18 55,12 82,16 100,31 110,53 84,55 66,36" fill="var(--n64-orb-light)" />
          <polygon points="15,53 29,32 45,18 66,36 84,55 54,78 20,74" fill="var(--n64-orb-facet)" />
          <polygon points="84,55 110,53 107,78 92,97 76,109 54,78" fill="var(--n64-orb-shade)" />
          <polygon points="20,74 54,78 76,109 50,109 29,96 15,76" fill="var(--n64-orb-bottom)" />
        </>
      )}
    </svg>
  );
}

/**
 * Temporary theme switcher for the unmerged N64 site, separate from real weather.
 * Deliberately no forecast badge, temperature, or weather status label.
 */
export function ArcadeWeatherPreviewBar({ weather }) {
  if (!weather?.isPreview) return null;
  return (
    <div className="n64-weather-test-bar" role="group" aria-label="Preview weather themes">
      <div className="n64-weather-test-heading">
        <strong>🎮 WEATHER THEMES</strong>
        <small>Auto = current Bangor forecast</small>
      </div>
      <div className="n64-weather-test-grid">
        {WEATHER_THEME_OPTIONS.map(([value, icon, label]) => (
          <button
            key={value}
            type="button"
            className="n64-weather-test-button"
            aria-pressed={weather.chosenTheme === value}
            aria-label={value === "auto" ? "Use automatic Bangor weather" : "Preview " + label + " theme"}
            onClick={() => weather.chooseTheme(value)}
          >
            <span aria-hidden="true">{icon}</span>
            <b>{label}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ArcadeWeatherScene({ mode, isNight }) {
  const rainy = mode === "rain" || mode === "storm";
  return (
    <div className="n64-weather-scene" aria-hidden="true">
      {isNight && <span className="n64-night-atmosphere" />}
      {isNight && (
        <svg className="n64-night-ridgeline" viewBox="0 0 1200 240" preserveAspectRatio="none" focusable="false">
          <polygon points="0,240 0,176 120,157 237,191 390,69 534,188 662,127 820,190 965,88 1104,175 1200,147 1200,240" fill="#233c63" />
          <polygon points="238,191 390,69 529,186 391,121" fill="#385979" />
          <polygon points="664,127 821,190 743,160" fill="#355775" />
          <polygon points="817,190 965,88 1105,175 963,133" fill="#425f7c" />
          <polygon points="0,240 0,205 173,214 315,182 488,225 620,188 776,220 928,174 1095,216 1200,197 1200,240" fill="#1b3856" />
          <polygon points="0,240 0,228 200,219 375,238 618,216 826,236 1036,216 1200,230 1200,240" fill="#254f5f" />
        </svg>
      )}
      {mode === "sunny" && !isNight && <span className="n64-weather-rays" />}
      {(isNight || mode === "sunny" || mode === "snow") &&
        <N64LowPolySkyOrb isNight={isNight} />}
      {isNight && mode !== "rain" && mode !== "storm" &&
        <div className="n64-weather-stars">{STARS.map(i =>
          <i
            key={i}
            className={i % 7 === 0 ? "n64-night-star--bright" : ""}
            style={{
              left: ((i * 37 + i * i * 13 + 9) % 97) + "%",
              top: ((i * 29 + i * i * 7 + 5) % 53) + "%",
              animationDelay: -(i % 11) * .75 + "s"
            }}
          />
        )}</div>}
      {(rainy || mode === "cloudy" || mode === "snow" || mode === "fog") &&
        <div className="n64-weather-extra-clouds">
          <N64LowPolyCloud className="n64-weather-extra-cloud n64-weather-extra-cloud--one" />
          <N64LowPolyCloud className="n64-weather-extra-cloud n64-weather-extra-cloud--two" />
        </div>}
      {rainy && <div className="n64-weather-rain">{DROPS.map(i =>
        <i key={i} style={{
          left: ((i * 47 + 7) % 100) + "%",
          animationDelay: -(i % 16) * 0.19 + "s",
          animationDuration: (0.85 + i % 7 * 0.12) + "s"
        }} />
      )}</div>}
      {mode === "snow" && <div className="n64-weather-snow">{FLAKES.map(i =>
        <i key={i} style={{
          left: ((i * 41 + 13) % 100) + "%",
          animationDelay: -(i % 13) * 0.46 + "s",
          animationDuration: (4.8 + i % 6 * 0.7) + "s"
        }} />
      )}</div>}
      {mode === "storm" && <span className="n64-weather-lightning" />}
      {mode === "storm" && <span className="n64-weather-lightning-fork" />}
      {mode === "fog" && (
        <div className="n64-fog-world">
          <span className="n64-fog-light" />
          <svg className="n64-fog-landscape" viewBox="0 0 1200 320" preserveAspectRatio="none" focusable="false">
            {/* Faceted distant hills and misty tree silhouettes, not pixel art. */}
            <polygon points="0,320 0,227 115,205 215,236 377,102 506,245 664,165 824,235 985,117 1131,214 1200,192 1200,320" fill="#7f9c9f" />
            <polygon points="215,236 377,102 508,244 382,159" fill="#9eb6b4" />
            <polygon points="663,165 825,235 739,194" fill="#a0b9b3" />
            <polygon points="822,236 985,117 1132,214 985,173" fill="#a8c0ba" />
            <polygon points="0,320 0,261 160,234 275,276 457,223 622,278 800,232 986,273 1130,226 1200,243 1200,320" fill="#719a96" />
            <polygon points="0,320 0,284 191,268 345,299 530,259 729,297 907,257 1102,283 1200,270 1200,320" fill="#8eb1a6" />
            <polygon points="80,277 117,177 154,277" fill="#7d9e96" />
            <polygon points="93,240 117,180 141,240" fill="#a6bdb2" />
            <polygon points="172,293 202,208 232,293" fill="#87a79e" />
            <polygon points="180,263 202,208 224,263" fill="#b0c4b7" />
            <polygon points="999,274 1039,174 1079,274" fill="#789e94" />
            <polygon points="1013,237 1039,174 1066,237" fill="#9eb9ab" />
            <polygon points="1090,300 1120,222 1150,300" fill="#80a69b" />
            <polygon points="1100,267 1120,222 1141,267" fill="#b7c9b9" />
          </svg>
          <span className="n64-fog-drift n64-fog-drift--back" />
          <span className="n64-fog-drift n64-fog-drift--middle" />
          <span className="n64-fog-drift n64-fog-drift--front" />
        </div>
      )}
    </div>
  );
}
