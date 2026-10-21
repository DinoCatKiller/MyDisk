import { Link } from "@tanstack/solid-router";
import { For } from "solid-js";

import type { FileNode } from "@MyDISK/api/schemas/file";

import styles from "./breadcrumb.module.css";

export type BreadcrumbProps = {
  /** 祖先链（含当前目录），由 `file.path` 返回。 */
  items: FileNode[];
};

export function Breadcrumb(props: BreadcrumbProps) {
  return (
    <nav class={styles.crumb} aria-label="位置">
      <Link class={styles.link} to="/files">
        全部文件
      </Link>
      <For each={props.items}>
        {(node) => (
          <>
            <span class={styles.sep} aria-hidden="true">
              /
            </span>
            <Link class={styles.link} to="/files/$" params={{ _splat: node.id }}>
              {node.name}
            </Link>
          </>
        )}
      </For>
    </nav>
  );
}
