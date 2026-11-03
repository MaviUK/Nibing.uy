import React, { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { supabase } from "../lib/supabaseClient"
import { submitClaim } from "../lib/standeeHelpers"

export default function StandeeSpottedClaim() {
  const { slug } = useParams()
  const navigate = useNavigate()

  const [standee, setStandee] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const [claimError, setClaimError] = useState(null)

  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [address, setAddress] = useState("")
  const [bin, setBin] = useState("")
  const [dates, setDates] = useState(["", ""])

  useEffect(() => {
    async function fetchStandee() {
      const { data, error } = await supabase
        .from("standee_location")
        .select("*")
        .eq("current_slug", slug)
        .maybeSingle()

      if (error || !data) {
        setClaimError("Standee not found.")
      } else if ((data.spotted_claims || 0) >= 2) {
        // ✅ Redirect to the "claims full" page
        navigate(`/standee/${slug}/spotted/closed`)
        return
      } else {
        setStandee(data)
      }

      setLoading(false)
    }

    fetchStandee()
  }, [slug, navigate])

  const handleDateChange = (value) => {
    setDates([value, getDatePlusDays(value, 14)])
  }

  const getDatePlusDays = (dateStr, days) => {
    if (!dateStr) return ""
    const date = new Date(dateStr)
    date.setDate(date.getDate() + days)
    return date.toISOString().split("T")[0]
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!name || !email || !phone || !address || !bin || !dates[0] || !dates[1]) {
      setClaimError("Please fill in all fields.")
      return
    }

    const response = await submitClaim({
      address: standee.current_address,
      bins: [bin],
      dates,
      neighbourName: name,
      nominatedAddress: address,
      town: "",
      postcode: "",
      isSpotted: true,
      email,
      phone
    })

    if (response.success) {
      await supabase
        .from("standee_location")
        .update({ spotted_claims: (standee.spotted_claims || 0) + 1 })
        .eq("id", standee.id)

      setSubmitted(true)
    } else {
      setClaimError(response.error || "Something went wrong.")
    }
  }

  if (loading) return <div className="bg-black text-white p-6">Loading...</div>

  if (claimError) {
    return (
      <div className="bg-black text-red-500 p-6 min-h-screen">
        <h1 className="text-2xl font-bold">{claimError}</h1>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="bg-black text-green-500 p-6 min-h-screen text-center">
        <h1 className="text-3xl font-bold mb-4">🎉 Success!</h1>
        <p>Your free bin clean is booked. Thank you for spotting the Wheelie Washer!</p>
      </div>
    )
  }

  return (
    <div className="bg-black text-white min-h-screen p-6 flex flex-col items-center">
      <img src="/logo.webp" alt="Ni Bin Guy" width="192" height="192" decoding="async" className="w-48 mb-4" />
      <h1 className="text-3xl font-bold text-center mb-2">🎯 You’ve Spotted The Wheelie Washer!</h1>
      <p className="text-center mb-6">
        Current Standee Location: <strong>{standee.current_address}</strong>
      </p>

      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4">
        <input
          type="text"
          placeholder="Your Name"
          className="w-full p-3 rounded bg-white text-black"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="email"
          placeholder="Email"
          className="w-full p-3 rounded bg-white text-black"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="tel"
          placeholder="Mobile Number"
          className="w-full p-3 rounded bg-white text-black"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <input
          type="text"
          placeholder="Your Address"
          className="w-full p-3 rounded bg-white text-black"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />

        <div>
          <p className="mb-2 font-bold">Select your bin:</p>
          <div className="flex gap-2">
            {["Black", "Blue", "Brown"].map((b) => (
              <button
                type="button"
                key={b}
                className={`flex-1 py-2 px-4 rounded font-bold ${
                  bin === b ? "bg-red-700 text-white" : "bg-white text-black"
                }`}
                onClick={() => setBin(b)}
              >
                {b}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 font-bold">Select the next 2 dates your bin is emptied:</p>
          <div className="flex gap-2">
            <input
              type="date"
              className="flex-1 p-3 rounded bg-white text-black"
              value={dates[0]}
              onChange={(e) => handleDateChange(e.target.value)}
            />
            <input
              type="date"
              className="flex-1 p-3 rounded bg-white text-black"
              value={dates[1]}
              readOnly
            />
          </div>
        </div>

        <button
          type="submit"
          className="w-full bg-red-700 hover:bg-red-600 text-white font-bold py-3 px-6 rounded"
        >
          Claim My Free Clean
        </button>
      </form>
    </div>
  )
}
