import { useCallback, useMemo, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Download,
  FileCode,
  Globe,
  Loader2,
  Sparkles,
  StopCircle,
} from "lucide-react";
import {
  exportFullSite,
  exportSinglePage,
  type ProgressEvent,
} from "@/lib/exporter";

type Mode = "single" | "site";

interface LogLine {
  id: number;
  kind: ProgressEvent["kind"];
  text: string;
  ts: string;
}

export default function App() {
  const [url, setUrl] = useState("https://wwdc26.framer.website");
  const [mode, setMode] = useState<Mode>("single");
  const [running, setRunning] = useState(false);
  const [percent, setPercent] = useState(0);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const logIdRef = useRef(0);

  const appendLog = useCallback((kind: ProgressEvent["kind"], text: string) => {
    setLogs((prev) => [
      ...prev.slice(-200),
      {
        id: ++logIdRef.current,
        kind,
        text,
        ts: new Date().toLocaleTimeString(),
      },
    ]);
  }, []);

  const onProgress = useCallback(
    (e: ProgressEvent) => {
      if (typeof e.percent === "number") setPercent(e.percent);
      appendLog(e.kind, e.message);
    },
    [appendLog],
  );

  const normalizedUrl = useMemo(() => {
    const trimmed = url.trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
  }, [url]);

  const start = async () => {
    if (!normalizedUrl) {
      appendLog("error", "请填写有效的 URL");
      return;
    }
    try {
      // Validate URL early so we fail before spawning a fetch.
      new URL(normalizedUrl);
    } catch {
      appendLog("error", "URL 格式无效");
      return;
    }

    setLogs([]);
    setPercent(0);
    setRunning(true);
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      if (mode === "single") {
        await exportSinglePage({
          url: normalizedUrl,
          signal: ac.signal,
          onProgress,
        });
      } else {
        await exportFullSite({
          url: normalizedUrl,
          signal: ac.signal,
          onProgress,
        });
      }
    } catch (err) {
      appendLog("error", (err as Error).message);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancel = () => {
    abortRef.current?.abort();
    appendLog("warn", "已请求中断");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      <div className="container max-w-3xl py-12">
        <header className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-cyan-300 dark:bg-slate-100 dark:text-slate-900">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">GGExport</h1>
            <p className="text-sm text-muted-foreground">
              一键把 Framer 站点导出为干净的静态 HTML，免费、本地运行、无水印。
            </p>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>导出 Framer 站点</CardTitle>
            <CardDescription>
              输入 Framer 站点首页 URL，选择导出模式后点击开始。HTML 会在你的
              浏览器内被抓取与清洗，不上传任何数据到本服务。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="url">站点 URL</Label>
              <Input
                id="url"
                placeholder="https://your-site.framer.website"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={running}
                autoComplete="off"
                spellCheck={false}
              />
            </div>

            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="single" disabled={running}>
                  <FileCode className="mr-2 h-4 w-4" />
                  单页
                </TabsTrigger>
                <TabsTrigger value="site" disabled={running}>
                  <Globe className="mr-2 h-4 w-4" />
                  整站
                </TabsTrigger>
              </TabsList>
              <TabsContent value="single">
                <p className="text-sm text-muted-foreground">
                  抓取目标 URL 的 SSR HTML，去除 Framer 标识后直接下载为
                  <code className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    index.html
                  </code>
                  。资源仍指向 Framer CDN。
                </p>
              </TabsContent>
              <TabsContent value="site">
                <p className="text-sm text-muted-foreground">
                  解析
                  <code className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    /sitemap.xml
                  </code>
                  发现所有页面，按路径生成
                  <code className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    path/index.html
                  </code>
                  目录结构，最终打包为 zip。直接上传到 Vercel / Netlify /
                  Cloudflare Pages 即可部署。
                </p>
              </TabsContent>
            </Tabs>

            <div className="flex items-center gap-3">
              {running ? (
                <Button variant="destructive" onClick={cancel}>
                  <StopCircle className="mr-2 h-4 w-4" />
                  停止
                </Button>
              ) : (
                <Button onClick={start} disabled={!normalizedUrl}>
                  <Download className="mr-2 h-4 w-4" />
                  开始导出
                </Button>
              )}
              {running && (
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  正在工作 ({percent}%)
                </span>
              )}
            </div>

            {(running || percent > 0) && (
              <Progress value={percent} className="h-2" />
            )}

            {logs.length > 0 && (
              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  日志
                </div>
                <div className="max-h-64 space-y-1 overflow-auto font-mono text-xs">
                  {logs.map((l) => (
                    <div
                      key={l.id}
                      className={
                        l.kind === "error"
                          ? "text-red-600 dark:text-red-400"
                          : l.kind === "warn"
                            ? "text-amber-600 dark:text-amber-400"
                            : l.kind === "success"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-foreground/80"
                      }
                    >
                      <span className="mr-2 text-muted-foreground">
                        {l.ts}
                      </span>
                      {l.text}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <footer className="mt-8 text-center text-xs text-muted-foreground">
          <p>
            GGExport 在浏览器内运行，通过公共 CORS 代理 (corsproxy.io /
            allorigins / codetabs) 抓取目标页面。
          </p>
          <p className="mt-1">
            请仅对你拥有权利或被授权导出的站点使用本工具。
          </p>
        </footer>
      </div>
    </div>
  );
}
