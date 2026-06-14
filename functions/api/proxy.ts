/**
 * GGExport same-origin fetch proxy (Cloudflare Pages Function).
 *
 * The browser cannot fetch a target site cross-origin, so the export flow needs
 * a proxy to read the page HTML / sitemap. Public CORS proxies
 * (corsproxy.io / allorigins.win / codetabs) are unreliable — they rate-limit,
 * go down, or block unregistered origins (which is exactly what broke export).
 *
 * This Function runs on the SAME origin as the app, so there is no CORS at all
 * and no third-party dependency. The client calls:
 *
 *   /api/proxy?url=<url-encoded-target>
 *
 * Cloudflare Pages routes requests to Functions before applying `_redirects`,
 * so the SPA `/* -> /index.html` rewrite does not shadow this endpoint.
 */

interface PagesContext {
  request: Request;
}

const FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (compatible; GGExport/1.0; +https://github.com/SwiftGGTeam/GGExport)",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const reqUrl = new URL(context.request.url);
  const target = reqUrl.searchParams.get("url");

  if (!target) {
    return new Response("Missing 'url' query parameter", { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response("Invalid 'url' parameter", { status: 400 });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return new Response("Only http(s) URLs are allowed", { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), {
      headers: FETCH_HEADERS,
      redirect: "follow",
    });
  } catch (err) {
    return new Response(`Upstream fetch failed: ${(err as Error).message}`, {
      status: 502,
    });
  }

  // Stream the upstream body straight through, preserving its status so the
  // caller (fetchViaProxy) can react to upstream 4xx/5xx and fall back.
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cache-Control", "no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export async function onRequestOptions(): Promise<Response> {
  // Not needed for same-origin calls, but lets the proxy be reused cross-origin.
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}
