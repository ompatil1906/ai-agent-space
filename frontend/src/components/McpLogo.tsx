"use client";

import { cn } from "cn";
import { brandIcon } from "@/lib/brand-icons";

/**
 * Renders a real brand logo for an MCP server as inline SVG (vendored from
 * simple-icons, CC0) — crisp at any size, offline-safe, theme-aware.
 * Falls back to a professional gradient monogram tile when no brand mark
 * exists (e.g. the official reference servers).
 */
export function McpLogo({
  slug,
  name,
  size = 28,
  color,
  className,
}: {
  slug?: string | null;
  name: string;
  size?: number;
  color?: string;
  className?: string;
}) {
  const icon = brandIcon(slug);

  if (icon) {
    return (
      <svg
        role="img"
        aria-label={`${name} logo`}
        viewBox="0 0 24 24"
        className={cn("shrink-0", className)}
        style={{ width: size, height: size }}
        fill={icon.fill}
      >
        <path d={icon.path} />
      </svg>
    );
  }

  // Monogram tile fallback — gradient, inner ring, bold initial
  const bg = color || "#6366f1";
  return (
    <span
      aria-label={`${name} logo`}
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-md font-semibold text-white",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-1px_0_rgba(0,0,0,0.15)] ring-1 ring-white/10",
        className
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.46,
        letterSpacing: "-0.03em",
        background: `linear-gradient(135deg, ${bg} 0%, color-mix(in srgb, ${bg} 55%, black) 100%)`,
      }}
    >
      {(name.trim()[0] || "•").toUpperCase()}
    </span>
  );
}
