import { For, Show, createSignal } from "solid-js";

import type { FileNode } from "@MyDISK/api/schemas/file";

import { Button } from "~/components/ui/button";
import { ChevronRightIcon, FolderIcon } from "~/components/ui/icons";
import { client } from "~/utils/orpc";

import styles from "./move-dialog.module.css";

type TreeNode = FileNode & { loaded: boolean; children: TreeNode[] };

export type MoveDialogProps = {
  /** 待移动节点名（用于展示与禁移自身判断） */
  sourceName: string;
  onConfirm: (targetParentId: string | null) => Promise<void>;
  onClose: () => void;
};

/** 单个可展开的目录节点（file.tree 惰性取子目录） */
function TreeItem(props: {
  node: TreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (node: TreeNode | null) => void;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const [children, setChildren] = createSignal<TreeNode[]>(props.node.children);
  const [loading, setLoading] = createSignal(false);

  const toggle = async () => {
    if (expanded()) {
      setExpanded(false);
      return;
    }
    if (!props.node.loaded) {
      setLoading(true);
      try {
        const result = await client.file.tree({ parentId: props.node.id });
        setChildren(result.map((child) => ({ ...child, loaded: false, children: [] })));
      } finally {
        setLoading(false);
      }
      props.node.loaded = true;
    }
    setExpanded(true);
  };

  return (
    <li class={styles.item} style={{ "padding-left": `${props.depth * 16 + 8}px` }}>
      <div class={styles.itemRow}>
        <Show
          when={children().length > 0 || !props.node.loaded}
          fallback={<span class={styles.gap} />}
        >
          <button
            type="button"
            class={[styles.expand, expanded() ? styles.expanded : ""]}
            onClick={() => void toggle()}
            aria-label={expanded() ? "收起" : "展开"}
          >
            <ChevronRightIcon size={13} />
          </button>
        </Show>
        <button
          type="button"
          class={[styles.itemButton, props.selectedId === props.node.id ? styles.selected : ""]}
          onClick={() => props.onSelect(props.node)}
        >
          <FolderIcon size={15} />
          {props.node.name}
        </button>
      </div>
      <Show when={expanded()}>
        <Show when={!loading()} fallback={<div class={styles.loading}>加载中…</div>}>
          <ul class={styles.list}>
            <For each={children()}>
              {(child) => (
                <TreeItem
                  node={child}
                  depth={props.depth + 1}
                  selectedId={props.selectedId}
                  onSelect={props.onSelect}
                />
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </li>
  );
}

/** 移动对话框：目标为同连接目录（`A3` file.move 校验禁止移入自身子孙） */
export function MoveDialog(props: MoveDialogProps) {
  const [roots, setRoots] = createSignal<TreeNode[]>([]);
  const [selected, setSelected] = createSignal<TreeNode | null>(null);
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  void client.file
    .tree({})
    .then((result) => setRoots(result.map((node) => ({ ...node, loaded: false, children: [] }))))
    .catch((loadError: unknown) =>
      setError(loadError instanceof Error ? loadError.message : "读取目录失败"),
    );

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await props.onConfirm(selected()?.id ?? null);
      props.onClose();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "移动失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class={styles.overlay} onClick={() => props.onClose()}>
      <div class={styles.dialog} onClick={(event) => event.stopPropagation()}>
        <header class={styles.header}>
          <span>移动「{props.sourceName}」到…</span>
          <button
            type="button"
            class={styles.close}
            onClick={() => props.onClose()}
            aria-label="关闭"
          >
            ✕
          </button>
        </header>

        <div class={styles.body}>
          <button
            type="button"
            class={`${styles.rootButton} ${selected() === null ? styles.selected : ""}`}
            onClick={() => setSelected(null)}
          >
            <FolderIcon size={15} />
            根目录（全部文件）
          </button>
          <ul class={styles.list}>
            <For each={roots()}>
              {(node) => (
                <TreeItem
                  node={node}
                  depth={0}
                  selectedId={selected()?.id ?? null}
                  onSelect={setSelected}
                />
              )}
            </For>
          </ul>
        </div>

        <Show when={error()}>
          <div class={styles.error}>{error()}</div>
        </Show>

        <footer class={styles.footer}>
          <Button variant="secondary" size="sm" onClick={() => props.onClose()}>
            取消
          </Button>
          <Button variant="primary" size="sm" disabled={busy()} onClick={() => void confirm()}>
            {busy() ? "移动中…" : "移动到此处"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
