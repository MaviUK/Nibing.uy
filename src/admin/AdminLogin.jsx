import React, { useState } from "react"
import { supabase } from "../lib/supabaseClient"
import { useNavigate } from "react-router-dom"

export default function AdminLogin() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const navigate = useNavigate()

  const handleLogin = async (e) => {
    e.preventDefault()

    const { error, data } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError("Login failed. Check your credentials.")
    } else {
      navigate("/admin")
    }
  }

  return (
    <div className="bg-black text-white min-h-screen flex items-center justify-center p-6">
      <form onSubmit={handleLogin} className="bg-white text-black p-6 rounded shadow max-w-sm w-full space-y-4">
        <h1 className="text-xl font-bold">Admin Login</h1>
        {error && <p className="text-red-600">{error}</p>}
        <input
          type="email"
          placeholder="Email"
          className="w-full p-2 border rounded"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          className="w-full p-2 border rounded"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className="w-full bg-black text-white py-2 rounded hover:bg-gray-800">
          Log In
        </button>
      </form>
    </div>
  )
}
