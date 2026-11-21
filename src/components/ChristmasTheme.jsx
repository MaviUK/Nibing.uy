import React, { useEffect, useState } from "react"
import { createPortal } from "react-dom"
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
  const [hero, setHero] = useState(null)
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
  useEffect(() => {
    if (!active) { setHero(null); return }
    const locate = () => setHero(document.querySelector("#main-content .n64-hero"))
    locate()
    const timer = window.setInterval(locate, 1000)
    return () => window.clearInterval(timer)
  }, [active])
  if (!active) return null
  return <div className="nbg-christmas-overlay" aria-hidden="true">
    <div className="nbg-christmas-lights">{Array.from({ length: 23 }, (_, i) => <span key={i} className={`nbg-bulb nbg-bulb-${i % 4}`} />)}</div>
    <div className="nbg-christmas-garland" />
    <div className="nbg-christmas-ornament nbg-christmas-ornament-left">★</div>
    <div className="nbg-christmas-ornament nbg-christmas-ornament-right">✦</div>
    <div className="nbg-christmas-snow">{flakes.map((flake, i) => <i key={i} style={{ left: `${flake.left}%`, animationDelay: `${flake.delay}s`, animationDuration: `${flake.duration}s`, width: flake.size, height: flake.size }} />)}</div>
    {hero && createPortal(<div className="nbg-christmas-scenery">    <div className="nbg-christmas-tree"><span className="nbg-tree-star">★</span><span className="nbg-tree-tier nbg-tree-tier-one"/><span className="nbg-tree-tier nbg-tree-tier-two"/><span className="nbg-tree-tier nbg-tree-tier-three"/><span className="nbg-tree-trunk"/>{Array.from({length:15},(_,i)=><i key={i} className={`nbg-tree-light nbg-tree-light-${i%4}`} style={{left:`${26+(i*19)%49}%`,top:`${29+Math.floor(i/5)*18+(i%3)*5}%`,animationDelay:`${(i%5)*-.35}s`}} />)}</div>
      <div className="nbg-santa-flight"><svg viewBox="0 0 360 115" xmlns="http://www.w3.org/2000" role="presentation">
      <g stroke="#38203c" strokeWidth="3" strokeLinejoin="round">
        {[0,1,2].map((i)=><g key={i} transform={`translate(${222+i*46},${24-i*7})`}>
          <path d="M5 37 L-4 15 M5 18 L-8 4 M5 18 L16 5" fill="none" stroke="#8e5b37" strokeWidth="4"/>
          <ellipse cx="16" cy="45" rx="22" ry="11" fill="#ac7444"/>
          <path d="M27 38 L37 30 L46 35 L42 47 L28 48" fill="#b67a49"/>
          <circle cx="40" cy="36" r="2" fill="#151d34"/>
          <path d="M5 52 L1 66 M23 52 L28 66" stroke="#6b402c" strokeWidth="5"/>
          </g>)}
        <path d="M135 76 Q166 65 203 43" fill="none" stroke="#eac76a" strokeWidth="2"/>
        <path d="M38 68 Q42 105 112 104 Q148 103 151 85 L146 85 Q137 96 105 94 L63 94 Q48 90 50 76Z" fill="#e8b62d"/>
        <path d="M47 49 Q35 54 40 75 Q50 92 112 89 Q137 86 140 67 L129 56Z" fill="#bb263c"/>
        <path d="M43 49 Q75 42 121 50 L129 57 L47 58Z" fill="#f6d44e"/>
        <path d="M78 44 Q64 32 71 18 Q79 9 94 18 L104 32 L105 52 L85 57Z" fill="#d52d3d"/>
        <circle cx="86" cy="19" r="14" fill="#f6d1ac"/>
        <path d="M72 15 Q78 -5 99 11 L105 18 L70 19Z" fill="#cb293a"/>
        <circle cx="104" cy="11" r="5" fill="#fff"/>
        <path d="M72 25 Q84 45 98 26 Q91 39 80 34Z" fill="#fff"/>
        <path d="M104 36 L127 45" stroke="#d62c3b" strokeWidth="10"/>
        <path d="M127 45 L140 42" stroke="#f5d4aa" strokeWidth="7"/>
        <path d="M44 105 Q95 113 157 101" stroke="#f4d35d" strokeWidth="5" fill="none"/>
      </g>
    </svg></div>
    </div>, hero)}
    <div className="nbg-christmas-corner"><span className="nbg-christmas-sparkle">★</span><span>CHRISTMAS LEVEL<br /><strong>2026 EDITION</strong></span><span className="nbg-christmas-sparkle">★</span></div>
  </div>
}
