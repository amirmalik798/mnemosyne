"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Moon, Sun, Type } from "lucide-react";

type Theme = "dark" | "light";
type AppFont = "source-sans" | "inter" | "atkinson" | "lato" | "plus-jakarta";
type ThemeContextValue = {
  theme: Theme;
  toggleTheme: () => void;
  font: AppFont;
  setFont: (font: AppFont) => void;
};

const THEME_STORAGE_KEY = "mnemosyne-theme";
const FONT_STORAGE_KEY = "mnemosyne-font";
const DEFAULT_FONT: AppFont = "source-sans";

function isAppFont(value: string | null): value is AppFont {
  return value === "source-sans" ||
    value === "inter" ||
    value === "atkinson" ||
    value === "lato" ||
    value === "plus-jakarta";
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [font, setFontState] = useState<AppFont>(DEFAULT_FONT);

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      const initialTheme: Theme = savedTheme === "light" ? "light" : "dark";
      const savedFont = window.localStorage.getItem(FONT_STORAGE_KEY);
      const initialFont: AppFont = isAppFont(savedFont) ? savedFont : DEFAULT_FONT;

      document.documentElement.dataset.theme = initialTheme;
      document.documentElement.dataset.font = initialFont;
      setTheme(initialTheme);
      setFontState(initialFont);
    } catch {
      document.documentElement.dataset.theme = "dark";
      document.documentElement.dataset.font = DEFAULT_FONT;
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      try {
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Theme still changes for the current session when storage is unavailable.
      }
      return next;
    });
  }, []);

  const setFont = useCallback((next: AppFont) => {
    setFontState(next);
    document.documentElement.dataset.font = next;
    try {
      window.localStorage.setItem(FONT_STORAGE_KEY, next);
    } catch {
      // Font still changes for the current session when storage is unavailable.
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, font, setFont }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function ThemeToggle() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("ThemeToggle must be rendered inside ThemeProvider");

  const { theme, toggleTheme } = context;
  const nextLabel = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      title={nextLabel}
      aria-label={nextLabel}
      aria-pressed={theme === "light"}
    >
      {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
      <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}

export function FontSelector() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("FontSelector must be rendered inside ThemeProvider");

  const { font, setFont } = context;

  return (
    <label className="font-selector-control" title="Choose the English font used throughout Mnemosyne">
      <Type size={16} aria-hidden="true" />
      <select
        value={font}
        onChange={(event) => setFont(event.target.value as AppFont)}
        aria-label="English font across the app"
      >
        <option value="source-sans">Source Sans 3</option>
        <option value="inter">Inter</option>
        <option value="atkinson">Atkinson Hyperlegible</option>
        <option value="lato">Lato</option>
        <option value="plus-jakarta">Plus Jakarta Sans</option>
      </select>
    </label>
  );
}
