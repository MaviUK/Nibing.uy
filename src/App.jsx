import React, { Suspense, lazy } from "react"
import { Routes, Route } from "react-router-dom"
import NiBinGuyLandingPage from "./LandingPage"

const StandeeClaim = lazy(() => import("./standee/StandeeClaim"))
const StandeeSpottedClaim = lazy(() => import("./standee/StandeeSpottedClaim"))
const StandeePreClaim = lazy(() => import("./standee/StandeePreClaim"))
const LatestStandeeRedirect = lazy(() => import("./pages/standee/latest"))
const StandeeSpottedClosed = lazy(() => import("./standee/StandeeSpottedClosed"))
const AdminLogin = lazy(() => import("./admin/AdminLogin"))
const AdminDashboard = lazy(() => import("./admin/AdminDashboard"))
const AuthCallback = lazy(() => import("./auth/AuthCallback"))

export default function App() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-black text-white flex items-center justify-center">Loading page…</div>}>
      <Routes>
        <Route path="/" element={<NiBinGuyLandingPage />} />
        <Route path="/standee/:slug" element={<StandeePreClaim />} />
        <Route path="/standee/:slug/claim" element={<StandeeClaim />} />
        <Route path="/standee/:slug/spotted" element={<StandeeSpottedClaim />} />
        <Route path="/standee/latest" element={<LatestStandeeRedirect />} />
        <Route path="/standee/:slug/spotted/closed" element={<StandeeSpottedClosed />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
      </Routes>
    </Suspense>
  )
}
