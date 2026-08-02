import React from "react"
import { useParams } from "react-router-dom"

export default function StandeeSpottedClosed() {
  const { slug } = useParams()

  return (
    <div className="bg-black text-white min-h-screen flex flex-col items-center justify-center p-6 text-center">
      <img src="/logo.webp" alt="Ni Bin Guy" width="192" height="192" decoding="async" className="w-48 mb-6" />

      <h1 className="text-3xl font-bold mb-4 text-red-500">🚫 All Free Washes Claimed</h1>

      <p className="mb-6 max-w-lg text-lg">
        Thanks for spotting the Wheelie Washer at this location — but all free washes have already been claimed here.
        <br /><br />
        Don’t worry! You can still book a professional bin clean using the link below 👇
      </p>

      <a
        href="https://wa.me/447555178484"
        target="_blank"
        rel="noopener noreferrer"
        className="bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-6 rounded text-lg"
      >
        Book a Clean on WhatsApp
      </a>
    </div>
  )
}
