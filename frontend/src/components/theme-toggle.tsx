"use client";

import { useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Reads the theme once on mount to avoid hydration mismatch. The no-FOUC
 * seed script lives in `layout.tsx` and runs before first paint.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(!document.documentElement.classList.contains("light"));
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    document.documentElement.classList.toggle("light", !next);
    try {
      window.localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* storage unavailable — theme just won't persist */
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="text-muted-foreground hover:text-foreground"
    >
      {dark ? (
        <SunIcon className="size-4 transition-transform duration-200 hover:rotate-45" />
      ) : (
        <MoonIcon className="size-4 transition-transform duration-200 hover:-rotate-12" />
      )}
    </Button>
  );
}
