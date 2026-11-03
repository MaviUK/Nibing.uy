import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";

function parseHashParams(hash) {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(h);
  return {
    access_token: params.get("access_token"),
    refresh_token: params.get("refresh_token"),
    type: params.get("type"), // sometimes "recovery" or others
  };
}

export default function AuthCallback() {
  const [newPassword, setNewPassword] = useState("");
  const [success, setSuccess] = useState(false);
  const [mode, setMode] = useState<"loading" | "oauth" | "reset">("loading");
  const navigate = useNavigate();

  const handleReset = async () => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      alert("Error updating password: " + error.message);
    } else {
      setSuccess(true);
      setTimeout(() => navigate("/admin/login"), 2000);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        // 1) If we arrived from Google OAuth implicit flow:
        // URL looks like /#access_token=...&refresh_token=...
        const { access_token, refresh_token } = parseHashParams(
          window.location.hash
        );

        if (access_token && refresh_token) {
          setMode("oauth");

          const { error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });

          if (error) {
            console.error("setSession error:", error);
            // fallback: send to login
            navigate("/login", { replace: true });
            return;
          }

          // Clean up the URL and send them to the dashboard
          window.history.replaceState(null, "", "/#/dashboard");
          navigate("/dashboard", { replace: true });
          return;
        }

        // 2) Otherwise, this is likely password recovery callback
        // Make sure a session exists/refreshes so updateUser works.
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          await supabase.auth.refreshSession();
        }

        setMode("reset");
      } catch (e) {
        console.error(e);
        // If anything goes wrong, show reset UI (safer than blank)
        setMode("reset");
      }
    })();
  }, [navigate]);

  // While we decide what this callback is for
  if (mode === "loading") {
    return (
      <div className="bg-black text-white min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full space-y-3">
          <h1 className="text-2xl font-bold">Signing you in…</h1>
          <p className="text-white/70 text-sm">Please wait.</p>
        </div>
      </div>
    );
  }

  // OAuth mode is handled by redirect; this is just a fallback UI
  if (mode === "oauth") {
    return (
      <div className="bg-black text-white min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full space-y-3">
          <h1 className="text-2xl font-bold">Signing you in…</h1>
          <p className="text-white/70 text-sm">Redirecting to your dashboard.</p>
        </div>
      </div>
    );
  }

  // Password reset UI (your original)
  return (
    <div className="bg-black text-white min-h-screen flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-4">
        <h1 className="text-2xl font-bold">🔒 Reset Your Password</h1>
        {success ? (
          <p className="text-green-500">✅ Password updated! Redirecting...</p>
        ) : (
          <>
            <input
              type="password"
              className="w-full p-3 rounded bg-white text-black"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button
              onClick={handleReset}
              className="bg-red-700 text-white py-2 px-4 rounded font-bold"
            >
              Set New Password
            </button>
          </>
        )}
      </div>
    </div>
  );
}
