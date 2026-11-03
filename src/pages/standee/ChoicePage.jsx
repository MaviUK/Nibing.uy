import React, { useEffect, useState } from "react"
import { useParams, useNavigate, Link } from "react-router-dom"
import { supabase } from "../../lib/supabaseClient"

export default function ChoicePage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [standee, setStandee] = useState(null)

  useEffect(() => {
    async function fetchStandee() {
      const { data, error } = await supabase
        .from("standee_location")
        .select("*")
        .eq("current_slug", slug.trim().toLowerCase())
        .maybeSingle()

      if (!data || error) {
        setStandee(null)
      } else {
        setStandee(data)
      }

      setLoading(false)
    }

    fetchStandee()
  }, [slug])

  if (loading) return <div className="bg-black text-white min-h-screen p-6">Loading...</div>

  if (!standee) {
    return (
      <div className="bg-black text-white min-h-screen p-6">
        <h1 className="text-2xl font-bold">No standee found</h1>
        <p>Please check the URL or try again later.</p>
      </div>
    )
  }

  return (
    <div className="bg-black min-h-screen text-white font-sans px-6 py-10 text-center">
      <Link to="/">
        <img src="/logo.webp" alt="Ni Bin Guy Logo" width="288" height="288" decoding="async" className="w-56 md:w-72 mx-auto hover:opacity-80 transition mb-6" />
      </Link>

      <h1 className="text-3xl font-bold mb-4">The Wheelie Washer is at:</h1>
      <p className="text-xl mb-6 font-semibold">{standee.current_address}</p>

      <div className="flex flex-col gap-4 max-w-xs mx-auto">
        <button
          onClick={() => navigate(`/standee/${slug}/claim`)}
          className="py-3 bg-green-500 text-black font-bold rounded shadow hover:bg-green-400 transition"
        >
          I Live Here
        </button>
        <button
          onClick={() => navigate(`/standee/${slug}/spotted`)}
          className="py-3 bg-white text-black font-bold rounded shadow hover:bg-gray-300 transition"
        >
          I Spotted the Wheelie Washer
        </button>
      </div>
    </div>
  )
}
