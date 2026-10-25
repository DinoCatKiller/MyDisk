import { Show, createSignal, onSettled } from "solid-js";

import type { FileNode } from "@MyDISK/api/schemas/file";

import { FolderIcon, FileIcon, FileImageIcon } from "~/components/ui/icons";
import { formatBytes, formatDateTime } from "~/lib/format";
import { client } from "~/utils/orpc";

import styles from "./properties-panel.module.css";

export type PropertiesPanelProps = {
  node: FileNode;
  onClose: () => void;
};

type FileStats = ReturnType<typeof client.file.stats> extends Promise<infer T> ? T : never;

/** 属性面板：数据来自 `file.stats`（大小 / 校验和 / 物理键 / 分享数，`A3`） */
export function PropertiesPanel(props: PropertiesPanelProps) {
  const [stats, setStats] = createSignal<FileStats | null>(null);
  const [loadError, setLoadError] = createSignal("");

  onSettled(() => {
    client.file
      .stats({ nodeId: props.node.id })
      .then(setStats)
      .catch((statsError: unknown) =>
        setLoadError(statsError instanceof Error ? statsError.message : "属性加载失败"),
      );
  });

  const icon = () => {
    if (props.node.type === "folder") {
      return <FolderIcon size={20} />;
    }
    if ((props.node.mime ?? "").startsWith("image/")) {
      return <FileImageIcon size={20} />;
    }
    return <FileIcon size={20} />;
  };

  return (
    <div class={styles.overlay} onClick={() => props.onClose()}>
      <aside class={styles.panel} onClick={(event) => event.stopPropagation()} aria-label="属性">
        <header class={styles.header}>
          <span class={styles.icon}>{icon()}</span>
          <span class={styles.title}>{props.node.name}</span>
          <button
            type="button"
            class={styles.close}
            onClick={() => props.onClose()}
            aria-label="关闭"
          >
            ✕
          </button>
        </header>

        <Show
          when={!loadError()}
          fallback={<div class={styles.empty}>属性加载失败：{loadError()}</div>}
        >
          <Show when={stats()} fallback={<div class={styles.empty}>加载中…</div>}>
            {(value) => (
              <dl class={styles.list}>
                <div class={styles.row}>
                  <dt>类型</dt>
                  <dd>
                    {value().node.type === "folder" ? "文件夹" : (value().node.mime ?? "文件")}
                  </dd>
                </div>
                <div class={styles.row}>
                  <dt>大小</dt>
                  <dd>{value().node.type === "folder" ? "—" : formatBytes(value().node.size)}</dd>
                </div>
                <div class={styles.row}>
                  <dt>存储连接</dt>
                  <dd>{value().connectionName}</dd>
                </div>
                <div class={styles.row}>
                  <dt>物理键</dt>
                  <dd class={styles.mono}>{value().storageKey || "—"}</dd>
                </div>
                <Show when={value().node.checksum}>
                  <div class={styles.row}>
                    <dt>SHA-256</dt>
                    <dd class={styles.mono} title={value().node.checksum ?? ""}>
                      {value().node.checksum}
                    </dd>
                  </div>
                </Show>
                <div class={styles.row}>
                  <dt>活跃分享</dt>
                  <dd>{value().shareCount}</dd>
                </div>
                <div class={styles.row}>
                  <dt>创建时间</dt>
                  <dd>{formatDateTime(value().node.createdAt)}</dd>
                </div>
                <div class={styles.row}>
                  <dt>修改时间</dt>
                  <dd>{formatDateTime(value().node.updatedAt)}</dd>
                </div>
              </dl>
            )}
          </Show>
        </Show>
      </aside>
    </div>
  );
}
