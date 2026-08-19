"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { verifyEmail } from "../../lib/auth";

function VerifyEmailStatus() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [status, setStatus] = useState<"checking" | "verified" | "error">("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("This link is missing its verification token.");
      return;
    }
    verifyEmail(token)
      .then(() => setStatus("verified"))
      .catch((err) => {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Verification failed");
      });
  }, [token]);

  return (
    <>
      <h1>Email verification</h1>
      {status === "checking" && <p>Verifying…</p>}
      {status === "verified" && (
        <>
          <p style={{ color: "#4ade80" }}>Your email is verified.</p>
          <Link href="/" style={{ color: "#8ab4f8" }}>
            Go to Media Vault
          </Link>
        </>
      )}
      {status === "error" && (
        <>
          <p style={{ color: "#f87171" }}>{error}</p>
          <Link href="/" style={{ color: "#8ab4f8" }}>
            Go to Media Vault
          </Link>
        </>
      )}
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <main style={{ maxWidth: 360, margin: "80px auto", padding: 24 }}>
      <Suspense fallback={<p>Loading…</p>}>
        <VerifyEmailStatus />
      </Suspense>
    </main>
  );
}
