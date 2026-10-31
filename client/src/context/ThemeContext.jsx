import { createContext, useContext } from "react";

export const THEMES = {
  Dark: {
    bg: "#0a0d14", surface: "#111520", card: "#151a28",
    border: "#1e2535", accent: "#4f6ef7", accent2: "#7c3aed",
    muted: "#3a4560", text: "#e2e8f0", textDim: "#6b7fa3",
    glass: "rgba(21,26,40,0.7)",
  },
  Darker: {
    bg: "#050508", surface: "#0a0a0f", card: "#0f0f18",
    border: "#16162a", accent: "#4f6ef7", accent2: "#7c3aed",
    muted: "#1a1a2e", text: "#e2e8f0", textDim: "#5566aa",
    glass: "rgba(10,10,15,0.8)",
  },
  Midnight: {
    bg: "#000510", surface: "#000d1a", card: "#001022",
    border: "#001f3f", accent: "#00aaff", accent2: "#0055ff",
    muted: "#002244", text: "#cce7ff", textDim: "#5599bb",
    glass: "rgba(0,10,30,0.8)",
  },
  Light: {
    bg: "#f0f4ff", surface: "#ffffff", card: "#f8faff",
    border: "#dde3f5", accent: "#4f6ef7", accent2: "#7c3aed",
    muted: "#e0e5f5", text: "#1a1f36", textDim: "#6b7fa3",
    glass: "rgba(255,255,255,0.85)",
  },
};

const ThemeCtx = createContext(THEMES.Dark);

export function ThemeProvider({ children, value = THEMES.Dark }) {
  return (
    <ThemeCtx.Provider value={value}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeCtx);
}
