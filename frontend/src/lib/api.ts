/**
 * Shared API client. One place reads the auth token, one place formats
 * errors — pages never touch `localStorage` or build Authorization headers
 * by hand.
 *
 * Backend contract: FastAPI under `/api/v1`, JWT bearer tokens, errors as
 * `{ detail: string }`. All money amounts arrive as integer minor units.
 */

import { useCallback, useEffect, useState } from "react";

const RAW =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

/** Always ends in `/api/v1` — safe to concatenate endpoint paths. */
export const API_BASE = RAW.replace(/\/+$/, "");

/* ---------------------------------------------------------------- tokens */

const TOKEN_KEY = "token";
export const AUTH_EVENT = "aas:auth";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.dispatchEvent(new Event(AUTH_EVENT));
}

export function clearToken() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event(AUTH_EVENT));
}

/* ---------------------------------------------------------------- errors */

export function messageFromError(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return "Something went wrong";
}

/* --------------------------------------------------------------- request */

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON body — stringified automatically (not used with `form`). */
  body?: unknown;
  /** Submit a multipart/form-data body instead (e.g. OAuth2 login). */
  form?: FormData;
  /** Attach the stored bearer token (default: true when present). */
  auth?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Throws `Error` (message = backend `detail`) on every non-2xx response. */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, form, auth = true, headers = {}, signal } = opts;

  const finalHeaders: Record<string, string> = { ...headers };
  if (!form && body !== undefined) finalHeaders["Content-Type"] = "application/json";
  if (auth !== false) {
    const token = getToken();
    if (token) finalHeaders["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: finalHeaders,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw new Error("Network error — is the backend running?");
  }

  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* ends without a JSON body — fall through */
  }

  if (!res.ok) {
    let detail =
      ((data as { detail?: unknown } | null) ?? {}).detail ?? null;
    if (detail != null && typeof detail !== "string") {
      // FastAPI validation arrays → join into one readable line
      try {
        detail = JSON.stringify(detail);
      } catch {
        detail = res.statusText;
      }
    }
    if (res.status === 401 && getToken()) clearToken();
    throw new Error(
      (detail as string) || res.statusText || `Request failed (${res.status})`
    );
  }
  return data as T;
}

export const apiGet = <T,>(path: string, signal?: AbortSignal) =>
  api<T>(path, { method: "GET", signal });

/* ------------------------------------------------------------ query hook */

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Minimal GET-with-state hook used by every page:
 *   const { data, loading, error, reload } = useApiQuery<Agent[]>(`/agents/`)
 * Pass `null` as the path to hold off fetching entirely.
 * Auth/token changes re-trigger the request automatically.
 */
export function useApiQuery<T>(
  path: string | null,
  opts: { /** set false to wait before fetching */ ready?: boolean } = {}
): QueryState<T> {
  const [tick, setTick] = useState(0);
  const [token, setTokenState] = useState<string | null>(null);
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const ready = opts.ready !== false;

  useEffect(() => {
    setTokenState(getToken());
    const onAuth = () => setTokenState(getToken());
    window.addEventListener(AUTH_EVENT, onAuth);
    return () => window.removeEventListener(AUTH_EVENT, onAuth);
  }, []);

  useEffect(() => {
    if (!path || !ready || !token) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api<T>(path, { method: "GET", signal: controller.signal })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if ((e as Error)?.name === "AbortError") return;
        setError(messageFromError(e));
        setLoading(false);
      });
    return () => controller.abort();
  }, [path, token, tick, ready]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { data, loading, error, reload };
}
