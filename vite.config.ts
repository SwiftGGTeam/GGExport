import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Same-origin fetch proxy for local development. In production this lives as a
 * Cloudflare Pages Function (functions/api/proxy.ts); here we replicate it so
 * `vite dev` and `vite preview` can run the export flow without any public
 * CORS proxy. Mirrors the Function's contract: GET /api/proxy?url=<target>.
 */
async function handleProxy(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const reqUrl = new URL(req.url ?? "", "http://localhost");
  const target = reqUrl.searchParams.get("url");

  if (!target) {
    res.statusCode = 400;
    res.end("Missing 'url' query parameter");
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    res.statusCode = 400;
    res.end("Invalid 'url' parameter");
    return;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    res.statusCode = 400;
    res.end("Only http(s) URLs are allowed");
    return;
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; GGExport/1.0)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      },
      redirect: "follow",
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    const contentType = upstream.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.end(buf);
  } catch (err) {
    res.statusCode = 502;
    res.end(`Upstream fetch failed: ${(err as Error).message}`);
  }
}

function sameOriginProxyPlugin(): Plugin {
  const middleware = (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void,
  ): void => {
    if (req.url && req.url.startsWith("/api/proxy")) {
      void handleProxy(req, res);
    } else {
      next();
    }
  };
  return {
    name: "ggexport-same-origin-proxy",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [react(), sameOriginProxyPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
