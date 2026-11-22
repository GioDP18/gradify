import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as authApi from '../services/authApi';
import { tokenStore } from '../services/tokenStore';

const AuthContext = createContext(null);

export const AUTH_STATUS = { LOADING: 'loading', AUTHENTICATED: 'authenticated', ANONYMOUS: 'anonymous' };

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(AUTH_STATUS.LOADING);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Restore an existing session from the refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    authApi
      .restoreSession()
      .then((restored) => {
        if (cancelled) return;
        setUser(restored);
        setStatus(AUTH_STATUS.AUTHENTICATED);
      })
      .catch(() => {
        if (!cancelled) setStatus(AUTH_STATUS.ANONYMOUS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // When a background refresh fails, drop to the login screen with an explanation.
  useEffect(
    () =>
      tokenStore.onSessionExpired(() => {
        queryClient.clear();
        setUser(null);
        setSessionExpired(true);
        setStatus(AUTH_STATUS.ANONYMOUS);
      }),
    [queryClient],
  );

  const login = useCallback(async (credentials) => {
    const loggedIn = await authApi.login(credentials);
    setSessionExpired(false);
    setUser(loggedIn);
    setStatus(AUTH_STATUS.AUTHENTICATED);
    return loggedIn;
  }, []);

  const logout = useCallback(async () => {
    // If the server cannot be reached this throws and the user stays signed in: the session
    // cookie can only be ended by the server, so pretending to be logged out would be unsafe.
    await authApi.logout();
    queryClient.clear();
    setSessionExpired(false);
    setUser(null);
    setStatus(AUTH_STATUS.ANONYMOUS);
  }, [queryClient]);

  // After the profile page saves, the header and greeting show the new name at once.
  const updateUser = useCallback((next) => setUser(next), []);

  const value = useMemo(
    () => ({ user, status, sessionExpired, login, logout, updateUser }),
    [user, status, sessionExpired, login, logout, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
