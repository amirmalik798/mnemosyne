"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Check, Moon, Palette, Sun, Type } from "lucide-react";

type Theme = "dark" | "light";
type ThemePreset = "obsidian" | "papyrus" | "arctic" | "verdant" | "amethyst";
type AppFont = "source-sans" | "inter" | "atkinson" | "lato" | "plus-jakarta";
type AppFontSize = "compact" | "default" | "comfortable" | "large";
type ThemeContextValue = {
  theme: Theme;
  toggleTheme: () => void;
  themePreset: ThemePreset;
  setThemePreset: (preset: ThemePreset) => void;
  font: AppFont;
  setFont: (font: AppFont) => void;
  fontSize: AppFontSize;
  setFontSize: (fontSize: AppFontSize) => void;
};

const THEME_STORAGE_KEY = "mnemosyne-theme";
const PRESET_STORAGE_KEY = "mnemosyne-theme-preset";
const FONT_STORAGE_KEY = "mnemosyne-font";
const FONT_SIZE_STORAGE_KEY = "mnemosyne-font-size";
const DEFAULT_PRESET: ThemePreset = "obsidian";
const PRESETS: { id: ThemePreset; name: string; description: string; defaultTheme: Theme; swatches: [string,string,string,string] }[] = [
  { id:"obsidian", name:"Obsidian", description:"Graphite depths, quiet contrast and champagne accents.", defaultTheme:"dark", swatches:["#080B10","#171F2B","#C5A059","#EAF0F6"] },
  { id:"papyrus", name:"Papyrus", description:"Warm archival paper, soft stone and restrained brass.", defaultTheme:"light", swatches:["#F7F3EA","#FFFDF8","#9A6B1F","#25231F"] },
  { id:"arctic", name:"Arctic", description:"Midnight blue, crisp surfaces and glacial cyan.", defaultTheme:"dark", swatches:["#07121C","#112839","#54C4DD","#E7F3F8"] },
  { id:"verdant", name:"Verdant", description:"Deep evergreen, natural layers and calm sage.", defaultTheme:"dark", swatches:["#0A1510","#172A20","#9FC68A","#ECF4EB"] },
  { id:"amethyst", name:"Amethyst", description:"Ink-plum surfaces, subtle depth and soft lavender.", defaultTheme:"dark", swatches:["#100C18","#241D32","#B69AF2","#F2ECFA"] },
];
const DEFAULT_FONT: AppFont = "source-sans";
const DEFAULT_FONT_SIZE: AppFontSize = "default";

function isPreset(value: string | null): value is ThemePreset { return PRESETS.some((preset) => preset.id === value); }

function isAppFont(value: string | null): value is AppFont {
  return value === "source-sans" ||
    value === "inter" ||
    value === "atkinson" ||
    value === "lato" ||
    value === "plus-jakarta";
}

function isAppFontSize(value: string | null): value is AppFontSize {
  return value === "compact" ||
    value === "default" ||
    value === "comfortable" ||
    value === "large";
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [themePreset, setThemePresetState] = useState<ThemePreset>(DEFAULT_PRESET);
  const [font, setFontState] = useState<AppFont>(DEFAULT_FONT);
  const [fontSize, setFontSizeState] = useState<AppFontSize>(DEFAULT_FONT_SIZE);

  useEffect(() => {
    try {
      const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      const initialTheme: Theme = savedTheme === "light" ? "light" : "dark";
      const savedPreset = window.localStorage.getItem(PRESET_STORAGE_KEY);
      const initialPreset = isPreset(savedPreset) ? savedPreset : DEFAULT_PRESET;
      const savedFont = window.localStorage.getItem(FONT_STORAGE_KEY);
      const initialFont: AppFont = isAppFont(savedFont) ? savedFont : DEFAULT_FONT;
      const savedFontSize = window.localStorage.getItem(FONT_SIZE_STORAGE_KEY);
      const initialFontSize: AppFontSize = isAppFontSize(savedFontSize) ? savedFontSize : DEFAULT_FONT_SIZE;

      document.documentElement.dataset.theme = initialTheme;
      document.documentElement.dataset.preset = initialPreset;
      document.documentElement.dataset.font = initialFont;
      document.documentElement.dataset.fontSize = initialFontSize;
      setTheme(initialTheme);
      setThemePresetState(initialPreset);
      setFontState(initialFont);
      setFontSizeState(initialFontSize);
    } catch {
      document.documentElement.dataset.theme = "dark";
      document.documentElement.dataset.preset = DEFAULT_PRESET;
      document.documentElement.dataset.font = DEFAULT_FONT;
      document.documentElement.dataset.fontSize = DEFAULT_FONT_SIZE;
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

  const setThemePreset = useCallback((next: ThemePreset) => {
    const nextTheme = PRESETS.find((preset) => preset.id === next)?.defaultTheme ?? "dark";
    setThemePresetState(next);
    setTheme(nextTheme);
    document.documentElement.dataset.preset = next;
    document.documentElement.dataset.theme = nextTheme;
    try {
      window.localStorage.setItem(PRESET_STORAGE_KEY, next);
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Preferences still apply for this session.
    }
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

  const setFontSize = useCallback((next: AppFontSize) => {
    setFontSizeState(next);
    document.documentElement.dataset.fontSize = next;
    try {
      window.localStorage.setItem(FONT_SIZE_STORAGE_KEY, next);
    } catch {
      // Text size still changes for the current session when storage is unavailable.
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, themePreset, setThemePreset, font, setFont, fontSize, setFontSize }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useAppTheme must be used inside ThemeProvider");
  return context;
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
      {theme === "dark" ? <Sun className="theme-sun-icon" size={18} aria-hidden="true" /> : <Moon className="theme-moon-icon" size={18} aria-hidden="true" />}
      <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
    </button>
  );
}

export function ThemePresetSettings() {
  const { themePreset, setThemePreset } = useAppTheme();
  return (
    <section id="themes" className="panel theme-preset-settings" aria-labelledby="theme-presets-heading">
      <div className="settings-section-heading">
        <div>
          <h2 className="panel-title" id="theme-presets-heading">App-wide themes</h2>
          <p className="page-subtitle">Five coordinated palettes for your archive, editor, navigation and dialogs. Every preset includes light and dark variants.</p>
        </div>
        <span className="theme-settings-mark"><Palette size={18} aria-hidden="true" /></span>
      </div>
      <div className="theme-preset-grid" role="group" aria-label="Choose an app-wide theme">
        {PRESETS.map((preset) => (
          <button key={preset.id} type="button" className={`theme-preset-card ${themePreset === preset.id ? "is-selected" : ""}`}
            onClick={() => setThemePreset(preset.id)} aria-pressed={themePreset === preset.id}
            aria-label={`Use ${preset.name} theme. ${preset.description}`}>
            <span className="theme-preset-card-top">
              <span className="theme-preset-name">{preset.name}</span>
              <span className="theme-preset-check" aria-hidden="true">{themePreset === preset.id ? <Check size={15} /> : null}</span>
            </span>
            <span className="theme-preset-swatches" aria-hidden="true">
              {preset.swatches.map((color, index) => <span key={index} className="theme-preset-swatch" style={{ backgroundColor: color }} />)}
            </span>
            <span className="theme-preset-description">{preset.description}</span>
            <span className="theme-preset-mode">{preset.defaultTheme === "light" ? "Opens in light mode" : "Opens in dark mode"}</span>
          </button>
        ))}
      </div>
      <p className="theme-preset-note">Your palette is saved in this browser and applied throughout the app. Use the top-bar appearance control to switch between light and dark variants.</p>
    </section>
  );
}

export function TypographySettings() {
  const { font, setFont, fontSize, setFontSize } = useAppTheme();

  return (
    <section id="typography" className="panel typography-settings-panel" aria-labelledby="typography-heading">
      <div className="settings-section-heading">
        <div>
          <h2 className="panel-title" id="typography-heading">Appearance & typography</h2>
          <p className="page-subtitle">
            Choose the typeface and reading size used throughout the archive.
          </p>
        </div>
      </div>

      <div className="typography-settings-grid">
        <div className="typography-setting">
          <label className="form-label" htmlFor="app-font-family">App-wide font</label>
          <select
            id="app-font-family"
            className="field typography-select"
            value={font}
            onChange={(event) => setFont(event.target.value as AppFont)}
            aria-describedby="app-font-family-help"
          >
            <option value="source-sans">Source Sans 3</option>
            <option value="inter">Inter</option>
            <option value="atkinson">Atkinson Hyperlegible</option>
            <option value="lato">Lato</option>
            <option value="plus-jakarta">Plus Jakarta Sans</option>
          </select>
          <p className="form-hint" id="app-font-family-help">
            Changes interface typography across every page.
          </p>
        </div>

        <div className="typography-setting">
          <label className="form-label" htmlFor="app-font-size">App-wide font size</label>
          <select
            id="app-font-size"
            className="field typography-select"
            value={fontSize}
            onChange={(event) => setFontSize(event.target.value as AppFontSize)}
            aria-describedby="app-font-size-help"
          >
            <option value="compact">Compact · 90%</option>
            <option value="default">Default · 100%</option>
            <option value="comfortable">Comfortable · 110%</option>
            <option value="large">Large · 120%</option>
          </select>
          <p className="form-hint" id="app-font-size-help">
            Scales interface text, labels, controls and reading aids together.
          </p>
        </div>
      </div>

      <div className="typography-preview" aria-live="polite">
        <span className="typography-preview-label">LIVE PREVIEW</span>
        <strong>Your knowledge, clearly arranged.</strong>
        <p>Mnemosyne gives every note and idea a considered place in your private archive.</p>
      </div>
      <p className="typography-settings-note">
        Your choices are saved in this browser and applied throughout the app. Arabic and Urdu retain their script-specific typefaces.
      </p>
    </section>
  );
}


/**
 * Compact font-family control retained for the Note Editor's writing guidance.
 * It updates the same app-wide preference exposed in Settings.
 */
export function FontSelector() {
  const { font, setFont } = useAppTheme();

  return (
    <label className="font-selector-control" title="Choose the font used throughout Mnemosyne">
      <Type className="font-selector-icon" size={17} aria-hidden="true" />
      <select
        value={font}
        onChange={(event) => setFont(event.target.value as AppFont)}
        aria-label="App-wide font family"
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
