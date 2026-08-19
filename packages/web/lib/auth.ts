const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";
const TOKEN_KEY = "vault_token";

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  emailVerified: boolean;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

// The API returns two different error shapes: a plain string for auth
// failures (e.g. "Invalid email or password"), and a zod .flatten() object
// for validation failures (e.g. { fieldErrors: { email: ["Invalid email"] } }).
function extractErrorMessage(data: any): string {
  if (typeof data?.error === "string") return data.error;
  const fieldErrors = data?.error?.fieldErrors;
  if (fieldErrors) {
    const first = Object.values(fieldErrors).flat()[0];
    if (first) return String(first);
  }
  return "Something went wrong. Please try again.";
}

async function postCredentials(path: "register" | "login", email: string, password: string) {
  const res = await fetch(`${API_URL}/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(extractErrorMessage(data));
  setToken(data.token);
  return data as { token: string; userId: string };
}

export const register = (email: string, password: string) => postCredentials("register", email, password);
export const login = (email: string, password: string) => postCredentials("login", email, password);

export function logout() {
  clearToken();
}

export async function requestPasswordReset(email: string) {
  const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(extractErrorMessage(data));
}

export async function resetPassword(token: string, password: string) {
  const res = await fetch(`${API_URL}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(extractErrorMessage(data));
}

export async function verifyEmail(token: string) {
  const res = await fetch(`${API_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(extractErrorMessage(data));
}

export async function resendVerification() {
  const token = getToken();
  if (!token) throw new Error("Not logged in");
  const res = await fetch(`${API_URL}/api/auth/resend-verification`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(extractErrorMessage(data));
}

// Verifies the stored token is still valid and fetches the current user.
// Called on every page load so a stale/expired token doesn't silently
// leave a broken session sitting in localStorage.
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const token = getToken();
  if (!token) return null;

  const res = await fetch(`${API_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    clearToken();
    return null;
  }
  return res.json();
}
