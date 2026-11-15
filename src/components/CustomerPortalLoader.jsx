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

  const portalKey = "25a031e7-75af-4a0e-9f3a-d308fd9b2e3a"
  const portalEndpoint = "https://sqgee.com"
  const widgets = [
    { id: "upcoming-appointments", title: "NEXT CLEAN", subtitle: "Your scheduled bin cleans", wide: false },
    { id: "appointment-history", title: "CLEAN HISTORY", subtitle: "Your previous visits", wide: false },
    { id: "financial-history", title: "PAYMENTS & HISTORY", subtitle: "Your account transactions", wide: false },
    { id: "automatic-payments", title: "AUTOMATIC PAYMENTS", subtitle: "Manage payment methods", wide: false },
    { id: "profile", title: "YOUR DETAILS", subtitle: "Manage your contact information", wide: false },
  ]
  return (
    <section id="customer-portal" className="nbg-portal-redesign" style={{ scrollMarginTop: "110px", padding: "64px 16px 80px", background: "#050505", color: "#fff" }}>
      <LevelWasher />
      <div className="nbg-portal-inner">
        <div className="n64-portal-eyebrow" aria-hidden="true">{standalone ? "SQUEEGEE · OFFICIAL CUSTOMER ACCESS" : "LEVEL 07 · CUSTOMER HQ"}</div>
        <h2 id="customer-portal-login" className="nbg-portal-heading">{standalone ? "SQUEEGEE CUSTOMER LOGIN" : "YOUR BIN HQ"}</h2>
        <p className="nbg-portal-intro">Appointments, cleaning history and payments — all in one place.</p>
        {standalone ? (
          <div className="n64-portal-shell">
            <div data-sqc="layout" data-sqa="25a031e7-75af-4a0e-9f3a-d308fd9b2e3a" data-sqe="https://sqgee.com" style={{ width: "100%", minHeight: "700px", boxSizing: "border-box" }} />
          </div>
        ) : (
          <>
        <div className="nbg-portal-login">
          <div className="nbg-portal-panel-heading"><span>01</span><div><strong>ACCOUNT LOGIN</strong><small>Secure Squeegee customer access</small></div></div>
          <div data-sqc="sign-in" data-sqa={portalKey} data-sqe={portalEndpoint} />
        </div>
        <div className="nbg-portal-grid">
          {widgets.map((widget, index) => (
            <div className="nbg-portal-tile" key={widget.id}>
              <div className="nbg-portal-panel-heading"><span>{String(index + 2).padStart(2, "0")}</span><div><strong>{widget.title}</strong><small>{widget.subtitle}</small></div></div>
              {widget.id === "upcoming-appointments" ? (
                <details className="nbg-portal-expand" open>
                  <summary>Show or hide full appointment schedule</summary>
                  <div className="nbg-portal-widget" data-sqc={widget.id} data-sqa={portalKey} data-sqe={portalEndpoint} />
                </details>
              ) : (
                <div className="nbg-portal-widget" data-sqc={widget.id} data-sqa={portalKey} data-sqe={portalEndpoint} />
              )}
            </div>
          ))}
        </div>
          </>
        )}
        <p className="nbg-portal-footnote">Your NI Bin Guy points and streaks remain in Customer HQ. Squeegee manages the account widgets above.</p>
      </div>
    </section>
  )
}
