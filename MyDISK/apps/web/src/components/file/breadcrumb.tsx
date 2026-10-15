import { useNavigate } from "@solidjs/router";
import { For } from "solid-js";

import type { FileRouterNode } from "@MyDISK/api/routers/file";

import styles from "./breadcrumb.module.css";

export type BreadcrumbProps = {
  /** 祖先链（含当前目录），由 `file.path` 返回。 */
  items: FileRouterNode[];
};

export function Breadcrumb(props: BreadcrumbProps) {
  const navigate = useNavigate();

  const go = (event: MouseEvent, href: string) => {
    event.preventDefault();
    navigate(href);
  };

  return (
    <nav class={styles.crumb} aria-label="位置">
      <a class={styles.link} href="/files" onClick={(event) => go(event, "/files")}>
        全部文件
      </a>
      <For each={props.items}>
        {(node) => (
          <>
            <span class={styles.sep} aria-hidden="true">
              /
            </span>
            <a
              class={styles.link}
              href={`/files/${node.id}`}
              onClick={(event) => go(event, `/files/${node.id}`)}
            >
              {node.name}
            </a>
          </>
        )}
      </For>
    </nav>
  );
}
