import React, { Suspense, lazy } from "react"
import { Routes, Route } from "react-router-dom"
import NiBinGuyLandingPage from "./LandingPage"
import "./n64-theme.css"
import "./n64-complete.css"
import "./n64-square.css"
import "./n64-finale.css"
import HomepageServiceSchema from "./HomepageServiceSchema"
import CustomerPortalLoader from "./components/CustomerPortalLoader"
import FinalLevel from "./components/FinalLevel"

const StandeeClaim = lazy(() => import("./standee/StandeeClaim"))
const StandeeSpottedClaim = lazy(() => import("./standee/StandeeSpottedClaim"))
const StandeePreClaim = lazy(() => import("./standee/StandeePreClaim"))
const LatestStandeeRedirect = lazy(() => import("./pages/standee/latest"))
const StandeeSpottedClosed = lazy(() => import("./standee/StandeeSpottedClosed"))
const StreetBookingPage = lazy(() => import("./pages/StreetBookingPage"))
const Metrics = lazy(() => import("./pages/Metrics"))
const TenSecondChallenge = lazy(() => import("./TenSecondChallenge"))
const AdminLogin = lazy(() => import("./admin/AdminLogin"))
const AdminDashboard = lazy(() => import("./admin/AdminDashboard"))
const AuthCallback = lazy(() => import("./auth/AuthCallback"))

function SiteFooter() {
  return (
    <footer className="bg-black text-zinc-400 text-center px-4 py-6">
      <p className="m-0 text-sm">© 2026 NI Bin Guy. All rights reserved.</p>
      <p className="mt-1 text-sm">
        Bangor, BT20 5NF · <a className="text-green-400 hover:underline" href="tel:07555178484">07555 178484</a> · <a className="text-green-400 hover:underline" href="https://nibing.uy/">nibing.uy</a> · <a className="text-green-400 hover:underline" href="mailto:info@nibing.uy">info@nibing.uy</a>
      </p>
      <p className="mt-2 text-sm">
        <a className="text-green-400 underline" href="/privacy-policy.html">Privacy Policy</a>
      </p>
    </footer>
  )
}

function HomePage() {
  return (
    <>
      <HomepageServiceSchema />
      <NiBinGuyLandingPage />
      <CustomerPortalLoader />
      <FinalLevel />
      <SiteFooter />
    </>
  )
}

export default function App() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black text-white flex items-center justify-center">Loading page…</div>}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/street-booking" element={<StreetBookingPage />} />
        <Route path="/metric" element={<div className="n64-metrics"><Metrics /></div>} />
        <Route path="/metrics" element={<div className="n64-metrics"><Metrics /></div>} />
        <Route path="/challenge-email-test-0825" element={<div className="n64-challenge-route"><TenSecondChallenge autoWin /></div>} />
        <Route path="/standee/:slug" element={<div className="n64-sidequest"><StandeePreClaim /></div>} />
        <Route path="/standee/:slug/claim" element={<div className="n64-sidequest"><StandeeClaim /></div>} />
        <Route path="/standee/:slug/spotted" element={<div className="n64-sidequest"><StandeeSpottedClaim /></div>} />
        <Route path="/standee/latest" element={<LatestStandeeRedirect />} />
        <Route path="/standee/:slug/spotted/closed" element={<div className="n64-sidequest"><StandeeSpottedClosed /></div>} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
      </Routes>
    </Suspense>
  )
}
