import { marked } from "marked";
import DOMPurify from "dompurify";
import { Show, createEffect, createMemo, createSignal, onSettled } from "solid-js";

import type { FileNode } from "@MyDISK/api/schemas/file";
import type { PublicFileNode } from "@MyDISK/api/schemas/share";

import { DownloadIcon, FileIcon, FolderIcon, FileImageIcon } from "~/components/ui/icons";
import { formatBytes } from "~/lib/format";
import { TEXT_PREVIEW_MAX_BYTES, detectPreviewKind } from "~/lib/preview";
import { client } from "~/utils/orpc";

import styles from "./preview-dialog.module.css";

export type PreviewNode = Pick<FileNode | PublicFileNode, "id" | "type" | "name" | "mime" | "size">;

export type PreviewDialogProps = {
  node: PreviewNode;
  /** 预置的 inline 取流 URL（分享场景直接给；管理端可省略，组件内部调用 preview.url 生成） */
  url?: string;
  /** 可选：当前文件所在的列表，用于左右翻页（仅文件；跳过 folder） */
  siblings?: PreviewNode[];
  onClose: () => void;
  /** 翻页时由外部更新 node 并重新挂载 dialog */
  onNavigate?: (target: PreviewNode) => void;
};

/** 预览全家桶弹层（图片/视频/音频/PDF/Markdown/文本 + 回退） */
export function PreviewDialog(props: PreviewDialogProps) {
  const [resolvedUrl, setResolvedUrl] = createSignal<string | null>(props.url ?? null);
  const [loading, setLoading] = createSignal(!props.url);
  const [error, setError] = createSignal("");

  // 图片缩放：1 = 原始，< 1 缩小，> 1 放大
  const [imageScale, setImageScale] = createSignal(1);
  const [imageDragging, setImageDragging] = createSignal(false);
  const [dragOffset, setDragOffset] = createSignal({ x: 0, y: 0 });

  const kind = createMemo(() =>
    props.node.type === "file" ? detectPreviewKind(props.node.mime, props.node.name) : "unknown",
  );

  const isTextLike = () => kind() === "text" || kind() === "markdown";

  /** 文本超过上限 → Range 只取前 2MB；否则全量取 */
  const textRangeHeader = createMemo(() => {
    if (!isTextLike()) {
      return null;
    }
    const size = props.node.size;
    if (!size || size <= TEXT_PREVIEW_MAX_BYTES) {
      return null;
    }
    // 前端 Range：bytes=0-{上限-1}
    return `bytes=0-${TEXT_PREVIEW_MAX_BYTES - 1}`;
  });

  const textTruncated = createMemo(
    () => isTextLike() && !!props.node.size && props.node.size > TEXT_PREVIEW_MAX_BYTES,
  );

  /** 生成 inline 取流 URL（仅管理端） */
  createEffect(
    () => props.node.id,
    () => {
      if (props.url) {
        setResolvedUrl(props.url);
        setLoading(false);
        setError("");
        return;
      }
      setLoading(true);
      setError("");
      setImageScale(1);
      setDragOffset({ x: 0, y: 0 });
      void client.preview
        .url({ nodeId: props.node.id, inline: true, download: false })
        .then((result) => {
          setResolvedUrl(result.url);
          setLoading(false);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "获取预览地址失败");
          setLoading(false);
        });
    },
  );

  /** Esc 关闭 */
  onSettled(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        props.onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  // ---- 图片翻页 ----
  const fileSiblings = createMemo(() => (props.siblings ?? []).filter((s) => s.type === "file"));
  const currentIndex = createMemo(() => fileSiblings().findIndex((s) => s.id === props.node.id));
  const hasPrev = () => currentIndex() > 0;
  const hasNext = () =>
    fileSiblings().length > 0 && currentIndex() >= 0 && currentIndex() < fileSiblings().length - 1;

  const goPrev = () => {
    if (!hasPrev() || !props.onNavigate) {
      return;
    }
    props.onNavigate(fileSiblings()[currentIndex() - 1]);
  };
  const goNext = () => {
    if (!hasNext() || !props.onNavigate) {
      return;
    }
    props.onNavigate(fileSiblings()[currentIndex() + 1]);
  };

  // ---- 图片滚轮缩放 ----
  const onImageWheel = (e: WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    const next = Math.max(0.25, Math.min(5, imageScale() + delta));
    setImageScale(Number(next.toFixed(3)));
  };

  // ---- 图片拖拽 ----
  const dragStart = (e: MouseEvent) => {
    if (imageScale() <= 1) {
      return;
    }
    setImageDragging(true);
    dragStartPos = { x: e.clientX, y: e.clientY, offX: dragOffset().x, offY: dragOffset().y };
  };
  let dragStartPos: { x: number; y: number; offX: number; offY: number } = {
    x: 0,
    y: 0,
    offX: 0,
    offY: 0,
  };
  const dragMove = (e: MouseEvent) => {
    if (!imageDragging()) {
      return;
    }
    setDragOffset({
      x: dragStartPos.offX + (e.clientX - dragStartPos.x),
      y: dragStartPos.offY + (e.clientY - dragStartPos.y),
    });
  };
  const dragEnd = () => setImageDragging(false);

  const resetImageTransform = () => {
    setImageScale(1);
    setDragOffset({ x: 0, y: 0 });
  };

  // ---- 文本/Markdown 获取 ----
  const [textContent, setTextContent] = createSignal<string>("");
  const [textError, setTextError] = createSignal("");
  const [textLoading, setTextLoading] = createSignal(false);

  createEffect(
    () => resolvedUrl(),
    (url) => {
      if (!url || !isTextLike()) {
        setTextContent("");
        setTextError("");
        setTextLoading(false);
        return;
      }
      setTextLoading(true);
      setTextError("");
      const init: RequestInit = {};
      const range = textRangeHeader();
      if (range) {
        init.headers = { Range: range };
      }
      void fetch(url, init)
        .then(async (resp) => {
          if (!resp.ok && resp.status !== 206) {
            throw new Error(`HTTP ${resp.status}`);
          }
          return resp.text();
        })
        .then((text) => setTextContent(text))
        .catch((e) => setTextError(e instanceof Error ? e.message : "加载失败"))
        .finally(() => setTextLoading(false));
    },
  );

  const safeMarkdownHtml = createMemo(() => {
    if (kind() !== "markdown" || !textContent()) {
      return "";
    }
    const raw = marked.parse(textContent()) as string;
    return DOMPurify.sanitize(raw);
  });

  const icon = () => {
    if (props.node.type === "folder") {
      return <FolderIcon size={48} class={styles.fallbackIcon} />;
    }
    if ((props.node.mime ?? "").startsWith("image/")) {
      return <FileImageIcon size={48} class={styles.fallbackIcon} />;
    }
    return <FileIcon size={48} class={styles.fallbackIcon} />;
  };

  return (
    <div class={styles.overlay} onClick={props.onClose}>
      <header class={styles.header} onClick={(e) => e.stopPropagation()}>
        <span class={styles.title} title={props.node.name}>
          {props.node.name}
        </span>
        <span class={styles.meta}>
          {props.node.type === "file" ? formatBytes(props.node.size) : "文件夹"}
          {fileSiblings().length > 0 && currentIndex() >= 0
            ? ` · ${currentIndex() + 1} / ${fileSiblings().length}`
            : ""}
        </span>
        <Show when={props.node.type === "file"}>
          <Show when={props.onNavigate}>
            <button type="button" class={styles.headerBtn} onClick={goPrev} disabled={!hasPrev()}>
              ← 上一张
            </button>
            <button type="button" class={styles.headerBtn} onClick={goNext} disabled={!hasNext()}>
              下一张 →
            </button>
          </Show>
          <a
            type="button"
            class={styles.headerBtn}
            href={(resolvedUrl() ?? "") + (resolvedUrl()?.includes("?") ? "&dl=1" : "?dl=1")}
            target="_blank"
            rel="noreferrer"
          >
            <DownloadIcon size={13} /> 下载
          </a>
        </Show>
        <button
          type="button"
          class={`${styles.headerBtn} ${styles.danger}`}
          onClick={props.onClose}
          aria-label="关闭"
        >
          ✕
        </button>
      </header>

      <main
        class={styles.body}
        onClick={(e) => e.stopPropagation()}
        onMouseMove={dragMove}
        onMouseUp={dragEnd}
        onMouseLeave={dragEnd}
      >
        <Show when={loading()}>
          <div class={styles.centerMessage}>获取预览地址…</div>
        </Show>

        <Show when={!loading() && error()}>
          <div class={styles.centerMessage}>加载失败：{error()}</div>
        </Show>

        <Show when={!loading() && !error() && props.node.type === "folder"}>
          <div class={styles.fallback}>
            {icon()}
            <span class={styles.fallbackMeta}>文件夹不支持预览</span>
          </div>
        </Show>

        <Show when={!loading() && !error() && props.node.type === "file"}>
          {/* image */}
          <Show when={kind() === "image"}>
            <div class={styles.stage} onWheel={onImageWheel}>
              <img
                class={`${styles.image} ${imageScale() !== 1 ? styles.zoomed : ""}`}
                src={resolvedUrl() ?? ""}
                alt={props.node.name}
                draggable={false}
                onMouseDown={dragStart}
                onClick={() => {
                  if (imageScale() !== 1) {
                    resetImageTransform();
                  }
                }}
                style={{
                  transform: `translate(${dragOffset().x}px, ${dragOffset().y}px) scale(${imageScale()})`,
                  cursor: imageDragging() ? "grabbing" : undefined,
                }}
              />
              <Show when={props.onNavigate && fileSiblings().length > 1}>
                <button
                  type="button"
                  class={`${styles.navBtn} ${styles.prev}`}
                  onClick={goPrev}
                  disabled={!hasPrev()}
                  aria-label="上一张"
                >
                  ‹
                </button>
                <button
                  type="button"
                  class={`${styles.navBtn} ${styles.next}`}
                  onClick={goNext}
                  disabled={!hasNext()}
                  aria-label="下一张"
                >
                  ›
                </button>
              </Show>
              <span class={styles.zoomHint}>滚轮缩放 · 放大后可拖拽 · 点击图片重置</span>
            </div>
          </Show>

          {/* video */}
          <Show when={kind() === "video"}>
            <video class={styles.video} src={resolvedUrl() ?? ""} controls preload="metadata" />
          </Show>

          {/* audio */}
          <Show when={kind() === "audio"}>
            <audio class={styles.audio} src={resolvedUrl() ?? ""} controls />
          </Show>

          {/* pdf */}
          <Show when={kind() === "pdf"}>
            <iframe class={styles.pdfFrame} src={resolvedUrl() ?? ""} title={props.node.name} />
          </Show>

          {/* text / markdown */}
          <Show when={isTextLike()}>
            <div class={styles.textPane}>
              <Show when={textLoading()}>
                <div class={styles.centerMessage}>加载中…</div>
              </Show>
              <Show when={!textLoading() && textError()}>
                <div class={styles.centerMessage}>加载失败：{textError()}</div>
              </Show>
              <Show when={!textLoading() && !textError()}>
                <Show when={textTruncated()}>
                  <div class={styles.truncatedNotice}>
                    文件较大（{formatBytes(props.node.size)}），仅展示前{" "}
                    {formatBytes(TEXT_PREVIEW_MAX_BYTES)}。 完整内容请下载查看。
                  </div>
                </Show>
                <Show when={kind() === "markdown"} fallback={<pre>{textContent()}</pre>}>
                  <div
                    class={styles.markdownBody}
                    // eslint-disable-next-line solid/no-innerhtml
                    innerHTML={safeMarkdownHtml()}
                  />
                </Show>
              </Show>
            </div>
          </Show>

          {/* unknown → fallback */}
          <Show when={kind() === "unknown"}>
            <div class={styles.fallback}>
              {icon()}
              <span class={styles.fallbackName} title={props.node.name}>
                {props.node.name}
              </span>
              <span class={styles.fallbackMeta}>
                {props.node.mime ?? "未知类型"} · {formatBytes(props.node.size)}
              </span>
              <a
                type="button"
                class={styles.headerBtn}
                href={(resolvedUrl() ?? "") + (resolvedUrl()?.includes("?") ? "&dl=1" : "?dl=1")}
                target="_blank"
                rel="noreferrer"
              >
                <DownloadIcon size={14} /> 下载文件
              </a>
            </div>
          </Show>
        </Show>
      </main>
    </div>
  );
}
