import { useEffect } from "react"
import LevelWasher from "./LevelWasher.jsx"

export default function CustomerPortalLoader({ standalone = false }) {
  useEffect(() => {
    // Defer the Squeegee portal widget until a visitor approaches the section.
    // Customer HQ, booking and homepage interactions should paint first.
    const loadPortal = () => {
      if (document.getElementById("squeegee-widget-script")) return
      const script = document.createElement("script")
      script.id = "squeegee-widget-script"
      script.src = "https://widgets.sqg.ee/main.js"
      script.async = true
      document.head.appendChild(script)
    }
    const section = document.getElementById("customer-portal")
    if (standalone || !section || typeof IntersectionObserver !== "function") {
      loadPortal()
      return
    }
    if (["#customer-portal", "#customer-portal-login"].includes(window.location.hash))
      loadPortal()
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        loadPortal()
        observer.disconnect()
      }
    }, { rootMargin: "500px 0px" })
    observer.observe(section)
    return () => observer.disconnect()
  }, [standalone])

  // A direct link from /customer-hq loads the homepage before React mounts
  // the anchor, so explicitly honour the hash once this section is present.
  useEffect(() => {
    if (!["#customer-portal", "#customer-portal-login"].includes(window.location.hash)) return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("customer-portal-login")?.scrollIntoView({
        behavior: "auto", block: "start",
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  // Visiting the existing portal section earns a DAILY reward; merely
  // re-rendering the page or loading the external Squeegee widget does not.
  useEffect(() => {
    if (standalone) return
    const target=document.getElementById("customer-portal")
    if(!target || typeof IntersectionObserver!=="function")return
    const observer=new IntersectionObserver((entries)=>{
      if(entries.some(e=>e.isIntersecting && e.intersectionRatio>=0.2)){
        window.n64Score?.awardAction("customer-portal")
      }
    },{threshold:[0.2,0.4]})
    observer.observe(target)
    return ()=>observer.disconnect()
  }, [standalone])

  return (
    <section
      id="customer-portal"
      style={{
        scrollMarginTop: "110px",
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
          id="customer-portal-login"
          style={{
            fontSize: "1.875rem",
            fontWeight: "bold",
            color: "#4ade80",
            marginBottom: "12px",
          }}
        >
          {standalone ? "Squeegee Customer Login" : "Customer Portal"}
        </h2>
        {standalone && (
          <p style={{ color: "#d4d4d8", margin: "0 auto 24px", maxWidth: "720px" }}>
            Sign in below to the existing Squeegee customer portal to access the services and account features Squeegee provides. This is separate from your NI Bin Guy points login.
          </p>
        )}
        <div className="n64-portal-shell" style={{ background: "#18181b" }}>
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
