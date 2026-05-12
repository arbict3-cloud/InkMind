import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeId = "light" | "dark";

export const THEMES: { id: ThemeId; label: string; icon: string }[] = [
  { id: "light", label: "日间", icon: "☼" },
  { id: "dark", label: "夜间", icon: "☾" },
];

const GLOBAL_THEME_KEY = "inkmind_global_theme";

function readStoredTheme(): ThemeId {
  const stored = localStorage.getItem(GLOBAL_THEME_KEY);
  if (stored === "light" || stored === "dark") {
    return stored as ThemeId;
  }
  return "light";
}

function applyThemeToDocument(theme: ThemeId) {
  const html = document.documentElement;
  
  html.classList.remove("theme--light", "theme--dark");
  
  html.classList.add(`theme--${theme}`);
  
  if (theme === "dark") {
    html.style.colorScheme = "dark";
  } else {
    html.style.colorScheme = "light";
  }
}

type ThemeState = {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  isDark: boolean;
  isLight: boolean;
};

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(() => {
    if (typeof window !== "undefined") {
      return readStoredTheme();
    }
    return "light";
  });

  useEffect(() => {
    applyThemeToDocument(theme);
    localStorage.setItem(GLOBAL_THEME_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((newTheme: ThemeId) => {
    setThemeState(newTheme);
  }, []);

  const value = useMemo(
    () => ({
      theme,
      setTheme,
      isDark: theme === "dark",
      isLight: theme === "light",
    }),
    [theme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
