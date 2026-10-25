import { For, Show } from "solid-js";

import type { FileNodeRow } from "@MyDISK/db/schema";

import { FileRow, type FileView } from "./file-row";

import styles from "./file-list.module.css";

export type FileListProps = {
  items: FileNodeRow[];
  view: FileView;
  loading: boolean;
  onOpen: (node: FileNodeRow) => void;
  onDownload: (node: FileNodeRow) => void;
  onRename: (node: FileNodeRow) => void;
  onDelete: (node: FileNodeRow) => void;
  onFavorite: (node: FileNodeRow) => void;
  onMove: (node: FileNodeRow) => void;
  onProperties: (node: FileNodeRow) => void;
};

export function FileList(props: FileListProps) {
  return (
    <Show
      when={props.items.length > 0}
      fallback={
        <div class={styles.empty}>
          <Show when={props.loading} fallback={<span>此文件夹为空</span>}>
            <span>正在加载…</span>
          </Show>
        </div>
      }
    >
      <div class={props.view === "list" ? styles.table : styles.grid}>
        <Show when={props.view === "list"}>
          <div class={styles.head}>
            <span>名称</span>
            <span class={styles.headSize}>大小</span>
            <span class={styles.headTime}>修改时间</span>
            <span class={styles.headOps}>操作</span>
          </div>
        </Show>

        <For each={props.items}>
          {(node) => (
            <FileRow
              node={node}
              view={props.view}
              onOpen={props.onOpen}
              onDownload={props.onDownload}
              onRename={props.onRename}
              onDelete={props.onDelete}
              onFavorite={props.onFavorite}
              onMove={props.onMove}
              onProperties={props.onProperties}
            />
          )}
        </For>
      </div>
    </Show>
  );
}
