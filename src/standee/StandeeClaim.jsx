import React, { useEffect, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { supabase } from "../lib/supabaseClient"
import { submitClaim } from "../lib/standeeHelpers"

function slugify(text) {
  return text.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
}

export default function StandeeClaim() {
  const { slug } = useParams()
  const [loading, setLoading] = useState(true)
  const [standee, setStandee] = useState(null)
  const [isMatch, setIsMatch] = useState(false)

  const [selectedBin, setSelectedBin] = useState("")
  const [firstDate, setFirstDate] = useState("")
  const [secondDate, setSecondDate] = useState("")
  const [neighbourName, setNeighbourName] = useState("")
  const [nominatedAddress, setNominatedAddress] = useState("")
  const [town, setTown] = useState("")
  const [postcode, setPostcode] = useState("")
  const [submitted, setSubmitted] = useState(false)

  const minDate = new Date().toISOString().split("T")[0]
  const maxDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]

  useEffect(() => {
    async function fetchStandee() {
      const normalizedSlug = slug.trim().toLowerCase()
      const { data, error } = await supabase
        .from("standee_location")
        .select("*")
        .eq("current_slug", normalizedSlug)
        .maybeSingle()

      if (!data || error) {
        setStandee(null)
        setIsMatch(false)
      } else {
        setStandee(data)
        setIsMatch(data.current_slug === normalizedSlug)
      }

      setLoading(false)
    }

    fetchStandee()
  }, [slug])

  // Auto-fill secondDate 14 days after firstDate
  useEffect(() => {
    if (firstDate) {
      const first = new Date(firstDate)
      const second = new Date(first)
      second.setDate(first.getDate() + 14)
      setSecondDate(second.toISOString().split("T")[0])
    }
  }, [firstDate])

  const handleSubmit = async () => {
    const newAddress = `${nominatedAddress}, ${town}`
    const newSlug = slugify(newAddress)

    const response = await submitClaim({
      address: standee.current_address,
      bins: [selectedBin],
      dates: [firstDate, secondDate],
      neighbourName,
      nominatedAddress,
      town,
      postcode,
      newSlug,
      newAddress
    })

    if (response.success) {
      setSubmitted(true)
    } else {
      alert(`Something went wrong: ${response.error}`)
    }
  }

  if (loading) return <div className="bg-black text-white min-h-screen p-6">Loading...</div>

  if (!standee) {
    return (
      <div className="bg-black text-white min-h-screen p-6">
        <h1 className="text-2xl font-bold">No standee found</h1>
        <p>Please check the URL or try again later.</p>
      </div>
    )
  }

  if (!isMatch) {
    return (
      <div className="bg-black text-red-400 min-h-screen p-6">
        <h1 className="text-2xl font-bold">This isn't your standee!</h1>
        <p>This standee is meant for: <strong>{standee.current_address}</strong></p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="bg-black text-green-400 min-h-screen p-6 text-center">
        <div className="flex justify-center mb-4">
          <Link to="/">
            <img src="/logo.webp" alt="Ni Bin Guy Logo" width="288" height="288" decoding="async" className="w-56 md:w-72 hover:opacity-80 transition" />
          </Link>
        </div>
        <h1 className="text-3xl font-bold mb-4">🎉 Success!</h1>
        <p className="mb-4">
          Your free bin clean is booked. It will be cleaned on one of these 2 dates:
        </p>
        <p className="text-2xl font-semibold mb-6">
          {firstDate} or {secondDate}
        </p>
        <p>
          The Wheelie Washer is now heading to{" "}
          <strong>{neighbourName} at {nominatedAddress}, {town}</strong> ({postcode}).
        </p>

        <div className="mt-10">
          <h2 className="text-lg mb-2">Want to book more bins or set up a 4-weekly schedule?</h2>
          <Link to="/">
            <button className="mt-2 px-6 py-3 bg-red-700 text-white font-bold rounded shadow hover:bg-red-600 transition">
              Book Here
            </button>
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-black min-h-screen text-white font-sans px-6 py-10">
      <div className="flex justify-center mb-6">
        <Link to="/">
          <img src="/logo.webp" alt="Ni Bin Guy Logo" width="288" height="288" decoding="async" className="w-56 md:w-72 hover:opacity-80 transition" />
        </Link>
      </div>

      <div className="max-w-xl mx-auto">
        <h1 className="text-3xl font-bold text-center mb-6">🎁 You've Been Nominated For a Free Bin Clean!</h1>
        <p className="text-center mb-6">Current Standee Location: <strong>{standee.current_address}</strong></p>

        <div className="mb-6">
          <label className="block font-medium">Select your bin:</label>
          <div className="flex gap-3 mt-2">
            {["Black", "Blue", "Brown"].map((bin) => (
              <button
                key={bin}
                onClick={() => setSelectedBin(bin)}
                className={`px-4 py-2 rounded border ${
                  selectedBin === bin
                    ? "bg-green-500 text-black font-bold"
                    : "bg-white text-black"
                }`}
              >
                {bin}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <label className="block font-medium">Select the next 2 dates your bin is emptied:</label>
          <div className="flex gap-3 mt-2">
            <input
              type="date"
              value={firstDate}
              onChange={(e) => setFirstDate(e.target.value)}
              min={minDate}
              max={maxDate}
              className="p-2 rounded border w-1/2 text-black"
            />
            <input
              type="date"
              value={secondDate}
              readOnly
              className="p-2 rounded border w-1/2 text-black bg-gray-100"
            />
          </div>
        </div>

        <h2 className="text-2xl font-semibold text-green-400 text-center mb-6 mt-8">
          Now Please Nominate Someone Who Needs A Wheelie Wash!
        </h2>

        <div className="mb-6">
          <label className="block font-medium">Neighbour's Name:</label>
          <input
            type="text"
            value={neighbourName}
            onChange={(e) => setNeighbourName(e.target.value)}
            className="mt-2 p-2 border rounded w-full text-black"
          />
        </div>

        <div className="mb-6">
          <label className="block font-medium">Nominate your neighbour:</label>
          <input
            type="text"
            value={nominatedAddress}
            onChange={(e) => setNominatedAddress(e.target.value)}
            className="mt-2 p-2 border rounded w-full text-black"
          />
        </div>

        <div className="mb-6 flex gap-4">
          <div className="flex-1">
            <label className="block font-medium">Town:</label>
            <input
              type="text"
              value={town}
              onChange={(e) => setTown(e.target.value)}
              className="mt-2 p-2 border rounded w-full text-black"
            />
          </div>
          <div className="w-32">
            <label className="block font-medium">Postcode:</label>
            <input
              type="text"
              maxLength={10}
              value={postcode}
              onChange={(e) => setPostcode(e.target.value)}
              className="mt-2 p-2 border rounded w-full text-black"
            />
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={
            !selectedBin ||
            !firstDate ||
            !secondDate ||
            !neighbourName ||
            !nominatedAddress ||
            !town ||
            !postcode
          }
          className="w-full py-3 bg-red-700 text-white font-bold rounded shadow hover:bg-red-600 transition"
        >
          Claim My Free Clean
        </button>
      </div>
    </div>
  )
}
