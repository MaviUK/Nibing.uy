import React, { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { supabase } from "../../lib/supabaseClient"

export default function LatestStandeeRedirect() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function redirect() {
      const { data, error } = await supabase
        .from("standee_location")
        .select("current_slug")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (error || !data?.current_slug) {
        console.error("❌ Could not fetch latest standee:", error)
        setError("Could not find the latest standee.")
        setLoading(false)
        return
      }

      navigate(`/standee/${data.current_slug}`)
    }

    redirect()
  }, [navigate])

  if (loading) return <p className="text-white p-6">Redirecting to the latest standee...</p>
  if (error) return <p className="text-red-500 p-6">{error}</p>

  return null
}
