import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// Light / dark / "match my device".
//   preference: what the person chose ('light' | 'dark' | 'system'), remembered in localStorage
//   resolved:   what is actually shown ('light' | 'dark')
// The resolved value is written to <html data-theme="..."> and the CSS does the rest.
// index.html runs a tiny script before the first paint so a dark-mode visitor never sees a white flash.

export const THEME_KEY = 'slotbook.theme';
const CHOICES = ['light', 'dark', 'system'];
const ThemeContext = createContext(null);

function readPreference() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return CHOICES.includes(saved) ? saved : 'system';
  } catch {
    return 'system'; // storage can be blocked (private mode)
  }
}

const darkQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);

export function ThemeProvider({ children }) {
  const [preference, setPreferenceState] = useState(readPreference);
  const [systemDark, setSystemDark] = useState(() => darkQuery()?.matches ?? false);

  // Follow the device setting while the preference is "system".
  useEffect(() => {
    const query = darkQuery();
    if (!query) return undefined;
    const onChange = (event) => setSystemDark(event.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0b1a1d' : '#0e6b74');
  }, [resolved]);

  const setPreference = useCallback((next) => {
    if (!CHOICES.includes(next)) return;
    setPreferenceState(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  // The header button: flip whatever is showing now, and remember it as an explicit choice.
  const toggle = useCallback(() => setPreference(resolved === 'dark' ? 'light' : 'dark'), [resolved, setPreference]);

  const value = useMemo(() => ({ preference, resolved, setPreference, toggle }), [preference, resolved, setPreference, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
