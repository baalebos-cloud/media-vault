"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../hooks/useAuth";
import { resendVerification } from "../lib/auth";
import Uploader from "../components/Uploader";

export default function HomePage() {
  const router = useRouter();
  const { user, loading, token, logout } = useAuth();
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  // Redirect unauthenticated visitors to /login once we've finished
  // checking for a valid session (not before — that would flash a redirect
  // on every load even for logged-in users).
  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  if (loading) return <main style={{ padding: 24 }}>Loading…</main>;
  if (!user || !token) return null; // redirect already in flight

  const onResend = async () => {
    setResendStatus("sending");
    try {
      await resendVerification();
      setResendStatus("sent");
    } catch {
      setResendStatus("error");
    }
  };

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Media Vault</h1>
        <div style={{ fontSize: 13, color: "#999", display: "flex", alignItems: "center", gap: 8 }}>
          {user.email}
          <button
            onClick={() => {
              logout();
              router.push("/login");
            }}
            style={{
              background: "none",
              border: "1px solid #333",
              color: "#eee",
              borderRadius: 4,
              padding: "4px 8px",
              cursor: "pointer",
            }}
          >
            Log out
          </button>
        </div>
      </div>

      {!user.emailVerified && (
        <div
          style={{
            background: "#3a2f0b",
            border: "1px solid #8a6d1a",
            borderRadius: 6,
            padding: 12,
            marginBottom: 16,
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>Please verify your email address.</span>
          {resendStatus === "sent" ? (
            <span style={{ color: "#4ade80" }}>Sent — check your inbox</span>
          ) : (
            <button
              onClick={onResend}
              disabled={resendStatus === "sending"}
              style={{ background: "none", border: "1px solid #8a6d1a", color: "#eee", borderRadius: 4, padding: "4px 8px", cursor: "pointer" }}
            >
              {resendStatus === "sending" ? "Sending…" : "Resend email"}
            </button>
          )}
        </div>
      )}

      <Uploader token={token} />
    </main>
  );
}
