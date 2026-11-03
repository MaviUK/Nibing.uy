import React from "react";

/**
 * Original little low-poly wheelie-bin graphic for the N64-era preview.
 * No third-party game imagery/assets are used.
 */
export default function N64GameBin({ front = "#55b9ec", side = "#2b7fae", lid = "#83d8f7" }) {
  return (
    <svg className="n64-game-bin" viewBox="0 0 220 260" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <ellipse cx="117" cy="236" rx="79" ry="12" fill="#234168" opacity=".18" />
      <g stroke="#23365b" strokeLinejoin="round" strokeWidth="6">
        <path d="M60 172 L55 211" strokeLinecap="round" />
        <path d="M159 176 L165 213" strokeLinecap="round" />
        <circle cx="63" cy="208" r="17" fill="#29314d" />
        <circle cx="166" cy="208" r="17" fill="#29314d" />
        <circle cx="63" cy="208" r="6" fill="#a4bad6" strokeWidth="3" />
        <circle cx="166" cy="208" r="6" fill="#a4bad6" strokeWidth="3" />
        <path d="M67 50 Q70 23 91 22 L144 22 Q160 23 165 52" fill="none" strokeWidth="10" strokeLinecap="round" />
        <polygon points="48,63 157,62 184,77 75,82" fill={lid} />
        <polygon points="157,75 184,77 172,190 150,207" fill={side} />
        <polygon points="52,76 157,75 150,207 64,197" fill={front} />
      </g>
      <path d="M72 93 L138 91 L133 170 L78 164 Z" fill="#ffffff" opacity=".14" />
      <path d="M79 102 L106 101" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" opacity=".35" />
      <path d="M118 101 L132 100" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" opacity=".35" />
      <polygon points="48,63 157,62 184,77 75,82" fill="#ffffff" opacity=".16" />
      <rect x="83" y="122" width="51" height="37" rx="5" fill="#fffcf0" stroke="#273860" strokeWidth="4" transform="rotate(2 108 140)" />
      <text x="108" y="138" fill="#293b68" textAnchor="middle" fontFamily="Verdana, sans-serif" fontSize="10" fontWeight="900">NI BIN</text>
      <text x="108" y="151" fill="#293b68" textAnchor="middle" fontFamily="Verdana, sans-serif" fontSize="10" fontWeight="900">GUY</text>
    </svg>
  );
}
