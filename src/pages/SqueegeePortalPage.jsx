import React from "react"
import CustomerPortalLoader from "../components/CustomerPortalLoader"

// Keep Squeegee's own existing login widget unchanged. Customer HQ has a
// separate email-code login; there is no Squeegee single sign-on API.
export default function SqueegeePortalPage() {
  return (
    <main className="n64-world min-h-screen bg-black text-white">
      <nav
        aria-label="Squeegee portal navigation"
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "12px",
          padding: "17px max(16px, calc((100% - 1120px) / 2))",
          borderBottom: "3px solid #27375c",
          background: "#111827",
          fontSize: "13px",
          fontWeight: 900,
        }}
      >
        <a
          href="/customer-hq?ntl-drawer-state=hidden"
          style={{ color: "#f5d65c", textDecoration: "underline" }}
        >
          ← BACK TO MY POINTS
        </a>
        <span style={{ color: "#b9e4cd", letterSpacing: "0.07em" }}>
          NI BIN GUY · SQUEEGEE PORTAL
        </span>
        <a href="/" style={{ color: "#f5d65c" }}>NI BIN GUY HOME</a>
      </nav>
      <CustomerPortalLoader standalone />
      <p
        style={{
          maxWidth: "880px",
          margin: "0 auto",
          padding: "0 18px 48px",
          textAlign: "center",
          fontSize: "12px",
          lineHeight: 1.7,
          color: "#cad2e1",
        }}
      >
        The login above is provided by Squeegee. Your NI Bin Guy loyalty
        points login is separate, and this page does not share passwords or
        access your account without Squeegee's own authentication.
      </p>
    </main>
  )
}
