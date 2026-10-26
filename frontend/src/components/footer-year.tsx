"use client";

import { useEffect, useState } from "react";

/**
 * The © year is set post-hydration: prerendering (cacheComponents) forbids
 * time-dependent values in the server HTML.
 */
export function FooterYear() {
  const [year, setYear] = useState("");

  useEffect(() => {
    setYear(String(new Date().getFullYear()));
  }, []);

  return (
    <span suppressHydrationWarning>
      {year || "2026"}
    </span>
  );
}
