import React, { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { supabase } from "../lib/supabaseClient"

export default function PreClaimChoice() {
  const { slug } = useParams()
  const [standee, setStandee] = useState(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    async function fetchStandee() {
      const { data } = await supabase
        .from("standee_location")
        .select("*")
        .eq("current_slug", slug)
        .maybeSingle()
      setStandee(data || null)
      setLoading(false)
    }

    fetchStandee()
  }, [slug])

  if (loading) return <div className="bg-black text-white p-6">Loading...</div>

  if (!standee) {
    return (
      <div className="bg-black text-red-500 p-6 min-h-screen">
        <h1 className="text-2xl font-bold">Standee not found.</h1>
      </div>
    )
  }

  return (
    <div className="bg-black text-white p-6 min-h-screen text-center">
      <h1 className="text-3xl font-bold mb-4">The Wheelie Washer is at:</h1>
      <p className="text-xl mb-8">{standee.current_address}</p>

      <div className="flex flex-col gap-4 max-w-xs mx-auto">
        <button
          onClick={() => navigate(`/standee/${slug}`)}
          className="bg-green-500 text-black font-bold py-3 rounded hover:bg-green-400 transition"
        >
          I Live Here
        </button>

        <button
          onClick={() => navigate(`/standee/${slug}/spotted`)}
          className="bg-red-700 text-white font-bold py-3 rounded hover:bg-red-600 transition"
        >
          I Spotted the Wheelie Washer
        </button>
      </div>
    </div>
  )
}
