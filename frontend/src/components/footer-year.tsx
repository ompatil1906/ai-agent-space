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
      {year ? `© ${year} AI Agent Space.` : "AI Agent Space."} Payments and
      payouts are processed by Razorpay.
    </span>
  );
}
