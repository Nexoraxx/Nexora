import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const THEME_KEY = "nexora.theme";

function getSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    return (localStorage.getItem(THEME_KEY) as Theme) || "system";
  } catch {
    return "system";
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const isDark = theme === "dark" || (theme === "system" && getSystemTheme() === "dark");
  if (isDark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

const listeners = new Set<(theme: Theme) => void>();

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
  applyTheme(theme);
  listeners.forEach((fn) => fn(theme));
}

// Immediately apply stored theme on script evaluation
if (typeof window !== "undefined") {
  applyTheme(getStoredTheme());
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getStoredTheme() === "system") {
      applyTheme("system");
    }
  });
}

export function useTheme() {
  const [theme, setLocalTheme] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    const handler = (newTheme: Theme) => setLocalTheme(newTheme);
    listeners.add(handler);
    return () => void listeners.delete(handler);
  }, []);

  const isDark = theme === "dark" || (theme === "system" && getSystemTheme() === "dark");

  const toggle = () => {
    setTheme(isDark ? "light" : "dark");
  };

  return { theme, isDark, setTheme, toggle };
}
