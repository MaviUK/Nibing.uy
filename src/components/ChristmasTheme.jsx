import React, { useEffect, useState } from "react"
import "./christmas-theme.css"

export function isChristmasSeason(date = new Date()) {
  // UK civil date, independent of visitor timezone.
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", month: "numeric", day: "numeric" }).formatToParts(date)
  const month = Number(parts.find(part => part.type === "month")?.value)
  return month === 12
}

function isPreviewRequested() {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("christmas") === "preview"
}

const flakes = Array.from({ length: 42 }, (_, index) => ({
  left: (index * 37 + 13) % 100,
  delay: -((index * 7) % 19),
  duration: 12 + (index % 7) * 2,
  size: 3 + (index % 3) * 2,
}))

export default function ChristmasTheme() {
  const [active, setActive] = useState(() => isChristmasSeason() || isPreviewRequested())
  useEffect(() => {
    const update = () => setActive(isChristmasSeason() || isPreviewRequested())
    const timer = window.setInterval(update, 60_000)
    document.addEventListener("visibilitychange", update)
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", update) }
  }, [])
  useEffect(() => {
    document.documentElement.classList.toggle("nbg-christmas", active)
    return () => document.documentElement.classList.remove("nbg-christmas")
  }, [active])
  if (!active) return null
  return <div className="nbg-christmas-overlay" aria-hidden="true">
    <div className="nbg-christmas-lights">{Array.from({ length: 23 }, (_, i) => <span key={i} className={`nbg-bulb nbg-bulb-${i % 4}`} />)}</div>
    <div className="nbg-christmas-garland" />
    <div className="nbg-christmas-ornament nbg-christmas-ornament-left">★</div>
    <div className="nbg-christmas-ornament nbg-christmas-ornament-right">✦</div>
    <div className="nbg-christmas-snow">{flakes.map((flake, i) => <i key={i} style={{ left: `${flake.left}%`, animationDelay: `${flake.delay}s`, animationDuration: `${flake.duration}s`, width: flake.size, height: flake.size }} />)}</div>
    <div className="nbg-christmas-tree"><span className="nbg-tree-star">★</span><span className="nbg-tree-tier nbg-tree-tier-one"/><span className="nbg-tree-tier nbg-tree-tier-two"/><span className="nbg-tree-tier nbg-tree-tier-three"/><span className="nbg-tree-trunk"/>{Array.from({length:15},(_,i)=><i key={i} className={`nbg-tree-light nbg-tree-light-${i%4}`} style={{left:`${26+(i*19)%49}%`,top:`${29+Math.floor(i/5)*18+(i%3)*5}%`,animationDelay:`${(i%5)*-.35}s`}} />)}</div>
    <div className="nbg-santa-flight"><span className="nbg-santa-reindeer">🦌 🦌 🦌</span><span className="nbg-santa-sleigh">🎅🛷</span></div>
    <div className="nbg-christmas-corner"><span className="nbg-christmas-sparkle">★</span><span>CHRISTMAS LEVEL<br /><strong>2026 EDITION</strong></span><span className="nbg-christmas-sparkle">★</span></div>
  </div>
}
