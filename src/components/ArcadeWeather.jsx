import React, { useEffect, useState } from "react";

const MODES = new Set(["sunny", "cloudy", "rain", "snow", "fog", "storm"]);
const CACHE_KEY = "nbg_n64_weather_v1", TTL = 12 * 60 * 1000;
const FALLBACK = { mode: "sunny", isNight: false, temperatureC: null, available: false };
const DROPS = Array.from({ length: 62 }, (_, i) => i);
const FLAKES = Array.from({ length: 42 }, (_, i) => i);
const STARS = Array.from({ length: 21 }, (_, i) => i);

function readCache() {
  try {
    const entry = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
    if (!MODES.has(entry?.weather?.mode) || !Number.isFinite(entry.savedAt) ||
        Date.now() - entry.savedAt > 2 * 60 * 60 * 1000) return null;
    return entry;
  } catch { return null; }
}

/** Auto-update a fixed Bangor forecast without tracking customers or asking for GPS. */
export function useArcadeWeather() {
  const [weather, setWeather] = useState(() => {
    const saved = readCache();
    return saved ? { ...saved.weather, available: true } : FALLBACK;
  });

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
        setWeather(next);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ weather: next, savedAt: Date.now() })); } catch {}
      } catch {
        if (active && !readCache()) setWeather(FALLBACK);
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

/* A faceted, softly glowing sky orb with N64-era polygon shading. */
function N64LowPolySkyOrb({ isNight }) {
  return (
    <svg
      className={"n64-weather-orb " + (isNight ? "n64-weather-orb--moon" : "n64-weather-orb--sun")}
      viewBox="0 0 124 124"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
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
      {isNight && (
        <>
          <polygon points="44,46 53,42 60,49 57,57 47,60 40,53" fill="#a9b7b4" opacity=".25" />
          <polygon points="83,79 90,74 96,80 92,88 84,88" fill="#b7bfac" opacity=".23" />
        </>
      )}
    </svg>
  );
}

export function ArcadeWeatherScene({ mode, isNight }) {
  const rainy = mode === "rain" || mode === "storm";
  return (
    <div className="n64-weather-scene" aria-hidden="true">
      {mode === "sunny" && !isNight && <span className="n64-weather-rays" />}
      {(isNight || mode === "sunny" || mode === "snow") &&
        <N64LowPolySkyOrb isNight={isNight} />}
      {isNight && <div className="n64-weather-stars">{STARS.map(i =>
        <i key={i} style={{ left: ((i * 47 + 9) % 97) + "%", top: ((i * 31 + 8) % 59) + "%" }} />
      )}</div>}
      {(rainy || mode === "cloudy" || mode === "snow") &&
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
      {mode === "fog" && <span className="n64-weather-mist" />}
    </div>
  );
}
