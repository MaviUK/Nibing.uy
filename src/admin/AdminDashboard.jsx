import React, { useEffect, useState } from "react"
import { supabase } from "../lib/supabaseClient"
import { useNavigate } from "react-router-dom"

const allowedEmail = "info@nibing.uy"

export default function AdminDashboard() {
  const [locations, setLocations] = useState([])
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

 useEffect(() => {
  async function checkAccessAndFetch() {
    // Get updated session
    const {
      data: { session },
      error
    } = await supabase.auth.getSession()

    if (error || !session) {
      navigate("/admin/login")
      return
    }

    if (session.user.email !== allowedEmail) {
      navigate("/admin/login")
      return
    }

    // Fetch data after auth success
    const { data: locationData } = await supabase
      .from("standee_location")
      .select("*")
      .order("updated_at", { ascending: false })

    const { data: claimData } = await supabase
      .from("claims")
      .select("*")
      .order("claimed_at", { ascending: false })

    setLocations(locationData || [])
    setClaims(claimData || [])
    setLoading(false)
  }

  // Call immediately
  checkAccessAndFetch()
}, [navigate])



  if (loading) return <div className="bg-black text-white p-6">Loading admin dashboard...</div>

  return (
    <div className="bg-black text-white min-h-screen p-6">
      <h1 className="text-3xl font-bold mb-6">📋 Wheelie Washer Dashboard</h1>
      {locations.map((location) => {
        const matchedClaims = claims.filter(c => c.slug === location.current_slug)
        return (
          <div key={location.id} className="bg-white text-black p-4 mb-6 rounded shadow">
            <h2 className="text-xl font-bold mb-1">{location.current_address}</h2>
            <p className="text-sm text-gray-700 mb-2">Updated: {new Date(location.updated_at).toLocaleString()}</p>
            <p className="text-sm mb-3">Spotted Claims: {location.spotted_claims || 0}</p>
            {matchedClaims.length > 0 ? (
              <div className="space-y-2">
                {matchedClaims.map((claim, i) => (
                  <div key={i} className="border border-gray-500 rounded p-3 bg-gray-50">
                    <p><strong>Name:</strong> {claim.neighbourName}</p>
                    <p><strong>Email:</strong> {claim.email || "—"}</p>
                    <p><strong>Phone:</strong> {claim.phone || "—"}</p>
                    <p><strong>Address:</strong> {claim.nominated_address}</p>
                    <p><strong>Bins:</strong> {claim.bins?.join(", ")}</p>
                    <p><strong>Dates:</strong> {claim.dates?.join(", ")}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No claims submitted for this location yet.</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
