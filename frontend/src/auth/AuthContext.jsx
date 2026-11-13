import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import { setUnauthorizedHandler, tokenStore } from '../api/client';

// Holds "who is logged in" for the whole app.
//   status: 'loading' (checking a saved token) | 'authed' | 'anon'
//   expired: true when the server rejected our token mid-session, so the login page can say why.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(() => (tokenStore.get() ? 'loading' : 'anon'));
  const [expired, setExpired] = useState(false);

  // Any API call that comes back 401 while logged in ends the session everywhere.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      tokenStore.clear();
      setUser(null);
      setStatus('anon');
      setExpired(true);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // On page load, turn a saved token back into a user.
  useEffect(() => {
    if (!tokenStore.get()) return undefined;
    let active = true;
    api
      .getMe()
      .then((me) => {
        if (!active) return;
        setUser(me);
        setStatus('authed');
      })
      .catch(() => {
        // A 401 already cleared the token through the handler. Other errors (server down):
        // show the logged-out view but keep the token so a reload can recover.
        if (active) setStatus('anon');
      });
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    const token = await api.login({ email, password });
    tokenStore.set(token);
    try {
      const me = await api.getMe();
      setUser(me);
      setStatus('authed');
      setExpired(false);
      return me;
    } catch (error) {
      tokenStore.clear();
      throw error;
    }
  }, []);

  const signUp = useCallback(
    async ({ name, email, password }) => {
      await api.register({ name, email, password }); // registration always creates a customer
      return signIn(email, password);
    },
    [signIn],
  );

  // Re-read who we are (the role changes when a customer creates a provider profile).
  const refreshUser = useCallback(async () => {
    const me = await api.getMe();
    setUser(me);
    return me;
  }, []);

  const signOut = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setStatus('anon');
    setExpired(false);
  }, []);

  const value = useMemo(
    () => ({ user, status, expired, signIn, signUp, signOut, refreshUser }),
    [user, status, expired, signIn, signUp, signOut, refreshUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
