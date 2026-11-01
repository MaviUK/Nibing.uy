import { useEffect } from "react"
import LevelWasher from "./LevelWasher.jsx"

export default function CustomerPortalLoader({ standalone = false }) {
  useEffect(() => {
    if (document.getElementById("squeegee-widget-script")) return

    const script = document.createElement("script")
    script.id = "squeegee-widget-script"
    script.src = "https://widgets.sqg.ee/main.js"
    script.async = true
    document.head.appendChild(script)
  }, [])

  return (
    <section
      id="customer-portal"
      style={{
        padding: "64px 16px",
        background: "black",
        textAlign: "center",
        color: "white",
      }}
    >
      <LevelWasher />
      <div style={{ width: "100%", maxWidth: "1152px", margin: "0 auto" }}>
        <div className="n64-portal-eyebrow" aria-hidden="true">{standalone ? "SQUEEGEE · OFFICIAL CUSTOMER ACCESS" : "LEVEL 07 · CUSTOMER HQ"}</div>
        <h2
          style={{
            fontSize: "1.875rem",
            fontWeight: "bold",
            color: "#4ade80",
            marginBottom: "12px",
          }}
        >
          {standalone ? "Squeegee Customer Login" : "Customer Portal"}
        </h2>
        <p style={{ color: "#d4d4d8", margin: "0 auto 24px", maxWidth: "720px" }}>
          {standalone ? "Sign in below to the existing Squeegee customer portal to access the services and account features Squeegee provides. This is separate from your NI Bin Guy points login." : "Check your NI Bin Guy cleaning points, or use the existing Squeegee portal below for account services."}
        </p>
        {!standalone && <a href="/customer-hq?ntl-drawer-state=hidden" style={{display:"inline-flex",margin:"0 0 24px",padding:"13px 22px",background:"#f5d65c",color:"#111629",border:"3px solid #fff",boxShadow:"4px 4px #336347",fontWeight:900,textDecoration:"none",textTransform:"uppercase"}}>★ My Points &amp; Cleaning Streak →</a>}
        <div className="n64-portal-shell">
        <div
          data-sqc="layout"
          data-sqa="25a031e7-75af-4a0e-9f3a-d308fd9b2e3a"
          data-sqe="https://sqgee.com"
          style={{
            width: "100%",
            maxWidth: "1152px",
            minHeight: "700px",
            margin: "0 auto",
            display: "block",
            background: "#18181b",
            borderRadius: "1rem",
            boxShadow: "0 4px 10px rgba(0,0,0,0.3)",
            overflow: "visible",
            padding: "20px",
            boxSizing: "border-box",
          }}
        />
        </div>
      </div>
    </section>
  )
}
