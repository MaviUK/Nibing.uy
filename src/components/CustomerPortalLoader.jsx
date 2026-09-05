import { useEffect } from "react"

export default function CustomerPortalLoader() {
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
      <div style={{ width: "100%", maxWidth: "1152px", margin: "0 auto" }}>
        <h2
          style={{
            fontSize: "1.875rem",
            fontWeight: "bold",
            color: "#4ade80",
            marginBottom: "12px",
          }}
        >
          Customer Portal
        </h2>
        <p style={{ color: "#d4d4d8", margin: "0 auto 24px", maxWidth: "720px" }}>
          Existing customers can manage their service through the NI Bin Guy customer portal.
        </p>
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
    </section>
  )
}
