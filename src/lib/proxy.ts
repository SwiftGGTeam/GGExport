/**
 * Fetch-through proxies, tried in order with fallback on failure.
 *
 * The first entry is our OWN same-origin proxy: a Cloudflare Pages Function in
 * production (functions/api/proxy.ts) and a Vite middleware in local dev/preview
 * (see vite.config.ts). Being same-origin, it has no CORS, no rate limits, and
 * no third-party outages — it should handle every request.
 *
 * The remaining public CORS proxies are last-resort fallbacks only. They are
 * unreliable (they rate-limit, go down, or block unregistered origins — which is
 * what broke export in the first place) and only matter if the same-origin proxy
 * is somehow unavailable (e.g. opening the built files without the Function).
 */
const PROXIES: Array<(url: string) => string> = [
  (u) => `/api/proxy?url=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
];

export interface FetchOptions {
  /** Abort signal */
  signal?: AbortSignal;
  /** Timeout in ms per proxy attempt (default 20s) */
  timeoutMs?: number;
}

export async function fetchViaProxy(
  url: string,
  opts: FetchOptions = {},
): Promise<string> {
  const errors: string[] = [];
  for (const wrap of PROXIES) {
    const proxied = wrap(url);
    const ac = new AbortController();
    const timer = setTimeout(
      () => ac.abort(),
      opts.timeoutMs ?? 20_000,
    );
    const onAbort = () => ac.abort();
    opts.signal?.addEventListener("abort", onAbort);
    try {
      const res = await fetch(proxied, { signal: ac.signal });
      if (!res.ok) {
        errors.push(`${proxied}: HTTP ${res.status}`);
        continue;
      }
      return await res.text();
    } catch (err) {
      errors.push(`${proxied}: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
  throw new Error(
    `All CORS proxies failed for ${url}\n${errors.join("\n")}`,
  );
}
