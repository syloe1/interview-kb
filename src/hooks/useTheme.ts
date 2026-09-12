import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'pixel';

const THEME_STORAGE_KEY = 'interview-kb-theme';
const THEME_ORDER: Theme[] = ['light', 'dark', 'pixel'];

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
  if (stored && THEME_ORDER.includes(stored)) {
    return stored;
  }
  return 'light';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const cycleTheme = () => {
    const currentIndex = THEME_ORDER.indexOf(theme);
    const nextIndex = (currentIndex + 1) % THEME_ORDER.length;
    setTheme(THEME_ORDER[nextIndex]);
  };

  return { theme, setTheme, cycleTheme };
}
