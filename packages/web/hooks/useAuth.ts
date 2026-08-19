"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchCurrentUser,
  getToken,
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  type AuthUser,
} from "../lib/auth";

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setTokenState] = useState<string | null>(null);

  // On mount, verify any stored token is still valid rather than trusting
  // localStorage blindly — a token could be expired or revoked server-side.
  useEffect(() => {
    fetchCurrentUser().then((u) => {
      setUser(u);
      setTokenState(getToken());
      setLoading(false);
    });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiLogin(email, password);
    const me = await fetchCurrentUser();
    setUser(me);
    setTokenState(data.token);
    return data;
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const data = await apiRegister(email, password);
    const me = await fetchCurrentUser();
    setUser(me);
    setTokenState(data.token);
    return data;
  }, []);

  const logout = useCallback(() => {
    apiLogout();
    setUser(null);
    setTokenState(null);
  }, []);

  return { user, loading, token, login, register, logout };
}
