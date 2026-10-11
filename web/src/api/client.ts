import type { FieldError, Problem } from './types';

const TOKEN_KEY = 'dp.adminToken';
export const DEFAULT_TOKEN = 'dev-admin-token';

// ---------------------------------------------------------------------------
// Admin token store (localStorage + subscribers for useSyncExternalStore)

const listeners = new Set<() => void>();

function readToken(): string {
  try {
    const v = window.localStorage.getItem(TOKEN_KEY);
    return v === null ? DEFAULT_TOKEN : v;
  } catch {
    return DEFAULT_TOKEN;
  }
}

let currentToken = typeof window === 'undefined' ? DEFAULT_TOKEN : readToken();

export const tokenStore = {
  get: () => currentToken,
  set(value: string) {
    currentToken = value;
    try {
      window.localStorage.setItem(TOKEN_KEY, value);
    } catch {
      /* storage unavailable: keep in memory */
    }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

// ---------------------------------------------------------------------------
// Errors

export class ApiError extends Error {
  status: number;
  problem?: Problem;
  fieldErrors: FieldError[];

  constructor(status: number, message: string, problem?: Problem) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
    this.fieldErrors = problem?.errors ?? [];
  }

  /** Field errors indexed by field name (first message wins). */
  get byField(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const e of this.fieldErrors) if (!(e.field in out)) out[e.field] = e.message;
    return out;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Jeton d'administration invalide ou manquant (" + (err.problem?.detail ?? 'unauthorized') + ')';
    return err.problem?.detail || err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// Fetch wrapper

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = path.startsWith('/api') ? path : '/api/v1' + path;
  if (!query) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const needsAuth = opts.auth ?? method !== 'GET';
  if (needsAuth) headers.Authorization = `Bearer ${tokenStore.get()}`;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, "Impossible de joindre l'API (" + (e instanceof Error ? e.message : String(e)) + ')');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const problem = data && typeof data === 'object' && 'status' in (data as object) ? (data as Problem) : undefined;
    const msg = problem?.detail || problem?.title || (typeof data === 'string' && data) || `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, problem);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal, auth?: boolean) => request<T>(path, { query, signal, auth }),
  post: <T>(path: string, body?: unknown, auth?: boolean) => request<T>(path, { method: 'POST', body, auth }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: (path: string) => request<void>(path, { method: 'DELETE' }),
};
