/**
 * Parses a sitemap.xml document and returns the list of <loc> URLs that match
 * the given origin. Supports plain <urlset> and <sitemapindex> (recursive).
 */

import { fetchViaProxy } from "./proxy";

export async function discoverPages(
  rootUrl: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const root = new URL(rootUrl);
  const sitemapUrl = new URL("/sitemap.xml", root.origin).toString();
  const xml = await fetchViaProxy(sitemapUrl, { signal });
  const urls = await collectLocs(xml, root.origin, signal);
  // De-dup + filter to same origin only.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

async function collectLocs(
  xml: string,
  origin: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("sitemap.xml could not be parsed as XML");
  }

  const out: string[] = [];

  // <sitemapindex> → fan out to nested sitemaps.
  const nested = Array.from(doc.querySelectorAll("sitemap > loc")).map(
    (n) => (n.textContent ?? "").trim(),
  );
  for (const sm of nested) {
    if (!sm) continue;
    try {
      const childXml = await fetchViaProxy(sm, { signal });
      out.push(...(await collectLocs(childXml, origin, signal)));
    } catch {
      // Ignore individual nested sitemap failures.
    }
  }

  // <urlset><url><loc> → page URLs.
  const locs = Array.from(doc.querySelectorAll("url > loc")).map((n) =>
    (n.textContent ?? "").trim(),
  );
  for (const loc of locs) {
    if (!loc) continue;
    try {
      const u = new URL(loc);
      if (u.origin === origin) out.push(u.toString());
    } catch {
      // skip malformed entries
    }
  }

  // Multi-language Framer sites list non-default-locale URLs only as
  // <xhtml:link rel="alternate" hreflang="...">  inside the canonical <url>
  // entry — they never appear as a top-level <loc>. Without picking these up,
  // paths like /zh-cn/ are missing from the export and 404 on the deployed
  // static host. getElementsByTagNameNS matches the element by local name
  // regardless of namespace prefix.
  const altLinks = Array.from(doc.getElementsByTagNameNS("*", "link"));
  for (const link of altLinks) {
    const rel = (link.getAttribute("rel") ?? "").toLowerCase();
    if (rel !== "alternate") continue;
    const href = (link.getAttribute("href") ?? "").trim();
    if (!href) continue;
    try {
      const u = new URL(href);
      if (u.origin === origin) out.push(u.toString());
    } catch {
      // skip malformed entries
    }
  }

  return out;
}

/**
 * Convert an absolute URL to a directory-style local path.
 *   https://x.com/            -> index.html
 *   https://x.com/about       -> about/index.html
 *   https://x.com/blog/post-1 -> blog/post-1/index.html
 *   trailing slash and any query/hash are dropped.
 */
export function urlToFilePath(absoluteUrl: string): string {
  const u = new URL(absoluteUrl);
  let pathname = u.pathname.replace(/\/+$/, ""); // strip trailing slashes
  if (pathname === "" || pathname === "/") return "index.html";
  // Strip leading slash, sanitize illegal filesystem chars.
  pathname = pathname.replace(/^\/+/, "");
  const safe = pathname
    .split("/")
    .map((seg) => seg.replace(/[<>:"\\|?*]/g, "_"))
    .join("/");
  return `${safe}/index.html`;
}
