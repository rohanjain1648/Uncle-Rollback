export const GATEWAY_BASE = "https://api.sprites.dev/v1/gateway";
export const DEFAULT_TIMEOUT_MS = 60_000;

export class GatewayError extends Error {
  constructor(public status: number, public body: string, url: string) {
    super(`Gateway ${status} for ${url}: ${body.slice(0, 200)}`);
    this.name = "GatewayError";
  }
}

export type FetchImpl = typeof fetch;

export function gatewayUrl(provider: string, connectionId: string, path: string): string {
  return `${GATEWAY_BASE}/${provider}/${connectionId}/${path.replace(/^\/+/, "")}`;
}

export async function gatewayFetch(
  provider: string,
  connectionId: string,
  path: string,
  init?: RequestInit,
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  const url = gatewayUrl(provider, connectionId, path);
  // Never let one hung call block the one-at-a-time job queue.
  const res = await fetchImpl(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
  if (!res.ok) throw new GatewayError(res.status, await res.text(), url);
  return res;
}
