const rawUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export const API_BASE = rawUrl.endsWith("/api/v1")
  ? rawUrl.replace(/\/+$/, "")
  : `${rawUrl.replace(/\/+$/, "")}/api/v1`;
