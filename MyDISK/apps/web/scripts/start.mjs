/**
 * 生产环境单进程入口：TanStack Start SSR handler + `dist/client` 静态资源。
 * 需先执行 `bun run build`（= `vite build`），产物为 dist/client 与 dist/server。
 */
import { join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV ??= "production";

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const clientDir = join(appRoot, "dist", "client");

const { default: serverEntry } = await import(
  new URL("../dist/server/server.js", import.meta.url).href
);

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "0.0.0.0";

/** 从 dist/client 读取静态资源；不存在或路径穿越返回 null，交给 SSR 处理。 */
async function tryStatic(pathname) {
  let rel;
  try {
    rel = normalize(decodeURIComponent(pathname)).replace(/^[\\/]+/, "");
  } catch {
    return null;
  }
  if (!rel || rel.startsWith("..")) return null;
  const file = Bun.file(join(clientDir, rel));
  if (!(await file.exists())) return null;
  return new Response(file, {
    headers: {
      // assets/ 下均为哈希文件，可长缓存；其它（robots.txt 等）短缓存
      "cache-control": rel.startsWith(`assets${sep}`)
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600",
    },
  });
}

Bun.serve({
  port,
  hostname,
  idleTimeout: 120,
  async fetch(request) {
    const url = new URL(request.url);
    const asset = await tryStatic(url.pathname);
    if (asset) return asset;
    return serverEntry.fetch(request);
  },
});

console.log(`MyDisk 已启动：http://${hostname}:${port}`);
