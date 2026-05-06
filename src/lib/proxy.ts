/**
 * CORS proxies (free public services). We try them in order and fall back on failure.
 * If all fail, callers can show a clear error to the user.
 */
const PROXIES: Array<(url: string) => string> = [
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
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
