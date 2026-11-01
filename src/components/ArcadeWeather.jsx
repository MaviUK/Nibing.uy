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

export function ArcadeWeatherScene({ mode, isNight }) {
  const rainy = mode === "rain" || mode === "storm";
  return (
    <div className="n64-weather-scene" aria-hidden="true">
      {mode === "sunny" && !isNight && <span className="n64-weather-rays" />}
      {isNight && <span className="n64-weather-pixel-moon" />}
      {isNight && <div className="n64-weather-stars">{STARS.map(i =>
        <i key={i} style={{ left: ((i * 47 + 9) % 97) + "%", top: ((i * 31 + 8) % 59) + "%" }} />
      )}</div>}
      {(rainy || mode === "cloudy" || mode === "snow") &&
        <div className="n64-weather-extra-clouds"><i /><i /></div>}
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
