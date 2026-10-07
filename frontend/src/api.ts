// Thin client for the FastAPI backend (proxied at /api in dev and preview).

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** JSON request; a network failure or an unreachable backend (proxy 5xx) is reported as status 0. */
export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      ...(init?.json !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.json) } : {}),
    });
  } catch {
    throw new ApiError("offline", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (!body && res.status >= 500) throw new ApiError("offline", 0);
    const d = body?.detail;
    throw new ApiError(typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg).join("; ") : `HTTP ${res.status}`, res.status);
  }
  return body as T;
}

/** Subscribe to a job's server-sent events; returns a function that closes the stream. */
export function subscribe(path: string, handlers: Record<string, (data: any) => void>, onLost: () => void) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const es = new EventSource(`/api${path}`);
  for (const [name, fn] of Object.entries(handlers)) es.addEventListener(name, (e) => { if ((e as MessageEvent).data) fn(JSON.parse((e as MessageEvent).data)); });
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) onLost(); };
  return () => es.close();
}
