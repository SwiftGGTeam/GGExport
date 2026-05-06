import { fetchViaProxy } from "./proxy";
import { cleanFramerHtml, type CleanResult } from "./cleaner";
import { discoverPages, urlToFilePath } from "./sitemap";
import { buildZip, downloadBlob, downloadText } from "./zip";

export type ProgressKind = "info" | "success" | "warn" | "error";

export interface ProgressEvent {
  kind: ProgressKind;
  message: string;
  /** 0..100 — omit for indeterminate */
  percent?: number;
}

export type ProgressFn = (e: ProgressEvent) => void;

export interface ExportOptions {
  url: string;
  signal?: AbortSignal;
  onProgress?: ProgressFn;
}

export interface SinglePageResult {
  html: string;
  cleaned: CleanResult["removed"];
}

export async function exportSinglePage(
  opts: ExportOptions,
): Promise<SinglePageResult> {
  const { url, signal, onProgress } = opts;
  onProgress?.({ kind: "info", message: `抓取 ${url}`, percent: 10 });
  const raw = await fetchViaProxy(url, { signal });

  onProgress?.({ kind: "info", message: "清洗 Framer 标识", percent: 60 });
  const cleaned = cleanFramerHtml(raw);

  onProgress?.({
    kind: "success",
    message: `已移除：generator x${cleaned.removed.generatorMeta} · editor scripts x${cleaned.removed.editorScripts} · preloads x${cleaned.removed.editorPreloads} · badge nodes x${cleaned.removed.badgeNodes} · badge css rules x${cleaned.removed.badgeCssRules}`,
    percent: 95,
  });

  onProgress?.({ kind: "info", message: "准备下载 index.html", percent: 100 });
  downloadText(cleaned.html, "index.html");
  return { html: cleaned.html, cleaned: cleaned.removed };
}

export interface FullSiteResult {
  pageCount: number;
  failed: string[];
}

export async function exportFullSite(
  opts: ExportOptions,
): Promise<FullSiteResult> {
  const { url, signal, onProgress } = opts;
  onProgress?.({
    kind: "info",
    message: "解析 sitemap.xml ...",
    percent: 2,
  });
  const pages = await discoverPages(url, signal);
  if (pages.length === 0) {
    throw new Error(
      "sitemap.xml 中未找到任何页面。请确认目标站点提供了 /sitemap.xml。",
    );
  }
  onProgress?.({
    kind: "info",
    message: `发现 ${pages.length} 个页面`,
    percent: 5,
  });

  const files: Record<string, string> = {};
  const failed: string[] = [];

  // Aggregate cleanup counters across the whole site.
  const totals = {
    generatorMeta: 0,
    editorScripts: 0,
    editorPreloads: 0,
    badgeNodes: 0,
    badgeCssRules: 0,
  };

  // Concurrency-limited fetch loop. Public CORS proxies rate-limit aggressively,
  // so a small concurrency keeps us out of trouble.
  const concurrency = 4;
  let cursor = 0;
  let done = 0;

  async function worker() {
    while (cursor < pages.length) {
      if (signal?.aborted) return;
      const idx = cursor++;
      const pageUrl = pages[idx];
      const filePath = urlToFilePath(pageUrl);
      try {
        const raw = await fetchViaProxy(pageUrl, { signal });
        const cleaned = cleanFramerHtml(raw);
        files[filePath] = cleaned.html;
        totals.generatorMeta += cleaned.removed.generatorMeta;
        totals.editorScripts += cleaned.removed.editorScripts;
        totals.editorPreloads += cleaned.removed.editorPreloads;
        totals.badgeNodes += cleaned.removed.badgeNodes;
        totals.badgeCssRules += cleaned.removed.badgeCssRules;
      } catch (err) {
        failed.push(`${pageUrl}: ${(err as Error).message}`);
        onProgress?.({
          kind: "warn",
          message: `跳过 ${pageUrl}（${(err as Error).message}）`,
        });
      } finally {
        done++;
        const pct = 5 + Math.round((done / pages.length) * 85);
        onProgress?.({
          kind: "info",
          message: `已处理 ${done}/${pages.length}：${filePath}`,
          percent: pct,
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, pages.length) }, () => worker()),
  );

  if (Object.keys(files).length === 0) {
    throw new Error("所有页面都抓取失败，请检查 URL 与代理可用性");
  }

  // Drop a small README so users know what's inside.
  files["_GGExport-README.txt"] = renderReadme(opts.url, pages.length, totals, failed);

  onProgress?.({ kind: "info", message: "打包 zip ...", percent: 92 });
  const blob = await buildZip(files);

  const root = new URL(url);
  const zipName = `${root.hostname.replace(/[^a-zA-Z0-9.-]/g, "_")}.zip`;
  downloadBlob(blob, zipName);

  onProgress?.({
    kind: "success",
    message: `完成：${Object.keys(files).length - 1} 个 HTML，已下载 ${zipName}`,
    percent: 100,
  });

  return { pageCount: Object.keys(files).length - 1, failed };
}

function renderReadme(
  source: string,
  pageCount: number,
  totals: {
    generatorMeta: number;
    editorScripts: number;
    editorPreloads: number;
    badgeNodes: number;
    badgeCssRules: number;
  },
  failed: string[],
): string {
  return [
    `GGExport · 整站导出`,
    ``,
    `源站点 : ${source}`,
    `导出时间: ${new Date().toISOString()}`,
    `页面数 : ${pageCount}`,
    ``,
    `已移除的 Framer 标识统计：`,
    `  generator meta   : ${totals.generatorMeta}`,
    `  editor scripts   : ${totals.editorScripts}`,
    `  editor preloads  : ${totals.editorPreloads}`,
    `  badge DOM nodes  : ${totals.badgeNodes}`,
    `  badge CSS rules  : ${totals.badgeCssRules}`,
    ``,
    `资源策略 : 仅下载 HTML，CSS/JS/图片/字体仍指向 framerusercontent.com 等 CDN。`,
    `部署方式 : 直接把整个目录上传到任意静态托管 (Vercel / Netlify / Cloudflare Pages / GitHub Pages 等) 即可。`,
    ``,
    failed.length
      ? `失败的页面 (${failed.length}):\n${failed.map((f) => "  - " + f).join("\n")}`
      : `所有页面均成功导出。`,
  ].join("\n");
}
