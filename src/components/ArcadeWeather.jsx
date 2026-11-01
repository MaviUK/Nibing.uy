import React, { useEffect, useState } from "react";

const MODES = new Set(["sunny", "cloudy", "rain", "snow", "fog", "storm"]);
const LABELS = {
  sunny: ["☀", "SUNNY"], cloudy: ["☁", "CLOUDY"],
  rain: ["☂", "RAINY"], snow: ["❄", "SNOWING"],
  fog: ["≋", "FOGGY"], storm: ["⚡", "STORMY"]
};
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

function previewMode() {
  if (typeof window === "undefined" ||
      window.location.hostname !== "deploy-preview-77--nibinguy.netlify.app") return null;
  const requested = new URLSearchParams(window.location.search).get("weather")?.toLowerCase();
  if (!MODES.has(requested) && requested !== "night") return null;
  return { ...FALLBACK, mode: requested === "night" ? "sunny" : requested,
    isNight: requested === "night", isDemo: true };
}

/** Auto-update a fixed Bangor forecast without tracking customers or asking for GPS. */
export function useArcadeWeather() {
  const [demo] = useState(previewMode);
  const [weather, setWeather] = useState(() => {
    const cached = readCache();
    return demo || (cached ? { ...cached.weather, available: true } : FALLBACK);
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
    if (demo) return;
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
  }, [demo]);
  return weather;
}

export function ArcadeWeatherScene({ mode, isNight }) {
  const rainy = mode === "rain" || mode === "storm";
  return (
    <div className="n64-weather-scene" aria-hidden="true">
      {mode === "sunny" && !isNight && <span className="n64-weather-rays" />}
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
      {mode === "fog" && <span className="n64-weather-mist" />}
    </div>
  );
}

export function ArcadeWeatherBadge({ weather }) {
  const [icon, label] = LABELS[weather?.mode] || LABELS.sunny;
  const title = weather?.isDemo ? "TEST WEATHER" : weather?.available ? "BANGOR FORECAST" : "ARCADE SKY";
  const condition = weather?.mode === "sunny" && weather?.isNight ? "CLEAR NIGHT" : label;
  return (
    <div className="n64-weather-badge" aria-label={title + ": " + condition}>
      <span className="n64-weather-badge-icon" aria-hidden="true">{weather?.mode === "sunny" && weather?.isNight ? "☾" : icon}</span>
      <span className="n64-weather-badge-copy">
        <strong>{title} · {condition}
          {Number.isFinite(weather?.temperatureC) && " · " + weather.temperatureC + "°C"}
        </strong>
        {weather?.available
          ? <small>Forecast: <a href="https://www.met.no/en" target="_blank" rel="noopener noreferrer">MET Norway</a> (CC BY 4.0), adapted by NI Bin Guy</small>
          : <small>{weather?.isDemo ? "Weather effect preview" : "Classic sky until forecast is available"}</small>}
      </span>
    </div>
  );
}
