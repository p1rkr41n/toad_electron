import { useState, useEffect, useCallback } from "react";

export type ToadTheme = "light" | "dracula" | "dark";

export const getActiveTheme = (): ToadTheme => {
  try {
    const saved = localStorage.getItem("toad-theme-v2");
    if (saved === "dark") return "dark";
    if (saved === "light") return "light";
  } catch {}
  if (
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
};

export const applyTheme = (theme: ToadTheme, persist: boolean = true) => {
  if (persist) {
    try {
      localStorage.setItem("toad-theme-v2", theme);
      // Clean up legacy key to prevent stale state across updates
      localStorage.removeItem("toad-theme");
    } catch {}
  }
  if (typeof document !== "undefined") {
    const isDark = theme === "dark" || theme === "dracula";
    if (isDark) {
      document.documentElement.classList.add("toad-dark", "bp4-dark", "theme-dracula");
      document.body.classList.add("toad-dark", "bp4-dark", "theme-dracula");
    } else {
      document.documentElement.classList.remove("toad-dark", "bp4-dark", "theme-dracula");
      document.body.classList.remove("toad-dark", "bp4-dark", "theme-dracula");
    }
    if (typeof window !== "undefined" && (window as any).__TAURI__) {
      try {
        import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
          getCurrentWindow().setTheme(isDark ? "dark" : "light").catch(() => {});
        }).catch(() => {});
      } catch {}
    }
  }
};

export const toggleActiveTheme = (): ToadTheme => {
  const current = getActiveTheme();
  const next: ToadTheme = (current === "light") ? "dark" : "light";
  applyTheme(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("toad-theme-change", { detail: next })
    );
  }
  return next;
};

export const useToadTheme = (): [ToadTheme, () => void] => {
  const [theme, setTheme] = useState<ToadTheme>(() => {
    const t = getActiveTheme();
    const hasExplicit = (() => {
      try {
        return !!localStorage.getItem("toad-theme-v2");
      } catch {
        return false;
      }
    })();
    applyTheme(t, hasExplicit);
    return t;
  });

  useEffect(() => {
    const listener = (e: any) => {
      setTheme(e.detail);
    };
    window.addEventListener("toad-theme-change", listener);
    return () => window.removeEventListener("toad-theme-change", listener);
  }, []);

  const toggle = useCallback(() => {
    toggleActiveTheme();
  }, []);

  return [theme, toggle];
};

if (typeof window !== "undefined" && typeof document !== "undefined") {
  try {
    const initialTheme = getActiveTheme();
    const hasExplicit = (() => {
      try {
        return !!localStorage.getItem("toad-theme-v2");
      } catch {
        return false;
      }
    })();
    applyTheme(initialTheme, hasExplicit);
  } catch {}
}
