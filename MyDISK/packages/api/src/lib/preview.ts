/**
 * 预览类型判定（前后端共享）。
 * 输入 mime + 文件名（仅用作扩展名兜底），输出 preview kind，驱动前端渲染分支。
 *
 * 判定优先级：mime → 扩展名（兜底）→ unknown（走下载按钮）。
 * 类型定义在 `@MyDISK/api/schemas/preview`，前端通过 `import type` 消费。
 */

export const PREVIEW_KINDS = [
  "image",
  "video",
  "audio",
  "pdf",
  "markdown",
  "text",
  "unknown",
] as const;

export type PreviewKind = (typeof PREVIEW_KINDS)[number];

const IMAGE_PREFIXES = ["image/"] as const;
const VIDEO_PREFIXES = ["video/"] as const;
const AUDIO_PREFIXES = ["audio/"] as const;

const PDF_MIME = "application/pdf";
const MARKDOWN_EXTS = new Set(["md", "markdown", "mdown", "mkd"]);
const TEXT_MIMES = new Set([
  "text/plain",
  "text/html",
  "text/css",
  "text/xml",
  "text/yaml",
  "text/x-yaml",
  "text/markdown",
  "text/javascript",
  "text/typescript",
  "text/x-python",
  "text/x-java",
  "text/x-c",
  "text/x-c++",
  "text/x-csharp",
  "text/x-go",
  "text/x-rust",
  "text/x-ruby",
  "text/x-php",
  "text/x-sh",
  "text/x-bash",
  "text/x-sql",
  "text/x-json",
  "text/csv",
  "text/x-log",
  "text/x-properties",
  "application/json",
  "application/xml",
  "application/xhtml+xml",
  "application/javascript",
  "application/x-sh",
  "application/x-sql",
  "application/x-yaml",
]);

/** 大小上限：文本/Markdown 超过此阈值时前端只展示前 2MB（`A6` §7） */
export const TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

function extOf(name?: string | null): string | null {
  if (!name) {
    return null;
  }
  const idx = name.lastIndexOf(".");
  if (idx < 0 || idx === name.length - 1) {
    return null;
  }
  return name.slice(idx + 1).toLowerCase();
}

/**
 * 根据文件 mime + 文件名判定预览类型。
 * - mime 有值时按 mime 判断；
 * - mime 为空或命中 unknown 时用扩展名兜底；
 * - 仍无法识别 → `"unknown"`（前端展示下载按钮）。
 */
export function detectPreviewKind(
  mime: string | null | undefined,
  name?: string | null,
): PreviewKind {
  const cleanMime = (mime ?? "").toLowerCase();

  if (cleanMime === PDF_MIME) {
    return "pdf";
  }
  if (IMAGE_PREFIXES.some((prefix) => cleanMime.startsWith(prefix))) {
    return "image";
  }
  if (VIDEO_PREFIXES.some((prefix) => cleanMime.startsWith(prefix))) {
    return "video";
  }
  if (AUDIO_PREFIXES.some((prefix) => cleanMime.startsWith(prefix))) {
    return "audio";
  }
  if (cleanMime === "text/markdown") {
    return "markdown";
  }
  if (TEXT_MIMES.has(cleanMime)) {
    return "text";
  }

  // mime 无法判定 → 扩展名兜底
  const ext = extOf(name);
  if (ext) {
    if (MARKDOWN_EXTS.has(ext)) {
      return "markdown";
    }
    if (ext === "pdf") {
      return "pdf";
    }
  }
  return "unknown";
}
