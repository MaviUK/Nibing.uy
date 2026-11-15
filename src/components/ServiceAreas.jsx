import React from "react";
import { areas } from "../HomepageServiceSchema";
import LevelWasher from "./LevelWasher";

// Render the existing area section with React so it is also available at build time.
export default function ServiceAreas() {
  return <section id="areas-we-cover" style={{ padding: "64px 16px", background: "linear-gradient(180deg,#000 0%,#18181b 16%,#18181b 84%,#000 100%)", color: "white", textAlign: "center" }}>
    <div style={{ maxWidth: 1050, margin: "0 auto" }}>
      <h2 style={{ fontSize: "1.875rem", fontWeight: "bold", color: "#4ade80", margin: "0 0 14px" }}>Areas We Cover</h2>
      <p style={{ maxWidth: 760, margin: "0 auto 26px", color: "#d4d4d8", lineHeight: 1.7 }}>Ni Bin Guy provides wheelie bin cleaning across Bangor and nearby County Down towns. Choose your local area page for town-specific bin cleaning information.</p>
      <div className="areas" style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 10 }}>
        {areas.map(([name, url]) => <a key={name} href={new URL(url).pathname} title={`Wheelie bin cleaning in ${name}`} style={{ display: "inline-block", color: "#ffd400", background: "rgba(255,212,0,.12)", border: "1px solid rgba(255,212,0,.42)", borderRadius: 0, padding: "9px 13px", textDecoration: "none", fontWeight: 800 }}>{name}</a>)}
      </div>
    </div>
    <LevelWasher />
  </section>;
}
