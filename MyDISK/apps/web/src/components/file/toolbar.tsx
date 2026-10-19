import type { FileNodeRow } from "@MyDISK/db/schema";

import { Button } from "~/components/ui/button";
import {
  ChevronDownIcon,
  GridIcon,
  ListIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  UploadIcon,
} from "~/components/ui/icons";

import { Breadcrumb } from "./breadcrumb";
import type { FileView } from "./file-row";

import styles from "./toolbar.module.css";

export type SortField = "name" | "size" | "updatedAt" | "type";
export type SortOrder = "asc" | "desc";

export type ToolbarProps = {
  path: FileNodeRow[];
  keyword: string;
  onKeyword: (value: string) => void;
  sortField: SortField;
  sortOrder: SortOrder;
  onSortField: (field: SortField) => void;
  onToggleOrder: () => void;
  view: FileView;
  onView: (view: FileView) => void;
  loading: boolean;
  onCreateFolder: () => void;
  onPickFiles: (files: File[]) => void;
  onPickFolder: (files: File[]) => void;
  onRefresh: () => void;
};

export function Toolbar(props: ToolbarProps) {
  let fileInput: HTMLInputElement | undefined;
  let folderInput: HTMLInputElement | undefined;

  const readFiles = (
    event: Event & { currentTarget: HTMLInputElement },
    pick: (files: File[]) => void,
  ) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length > 0) {
      pick(files);
    }
    input.value = "";
  };

  const toggleClass = (active: boolean) =>
    [styles.toggle, active ? styles.toggleActive : ""].filter(Boolean).join(" ");

  return (
    <div class={styles.bar}>
      <Breadcrumb items={props.path} />

      <div class={styles.controls}>
        <label class={styles.search}>
          <SearchIcon size={15} />
          <input
            type="text"
            class={styles.searchInput}
            placeholder="搜索当前目录"
            value={props.keyword}
            onInput={(event) => props.onKeyword(event.currentTarget.value)}
          />
        </label>

        <div class={styles.sort}>
          <select
            class={styles.select}
            value={props.sortField}
            onChange={(event) => props.onSortField(event.currentTarget.value as SortField)}
          >
            <option value="name">名称</option>
            <option value="size">大小</option>
            <option value="updatedAt">修改时间</option>
            <option value="type">类型</option>
          </select>
          <button
            type="button"
            class={styles.iconButton}
            title={props.sortOrder === "asc" ? "升序" : "降序"}
            onClick={props.onToggleOrder}
          >
            <ChevronDownIcon
              size={15}
              class={props.sortOrder === "asc" ? styles.arrowUp : undefined}
            />
          </button>
        </div>

        <div class={styles.toggleGroup}>
          <button
            type="button"
            class={toggleClass(props.view === "list")}
            title="列表视图"
            onClick={() => props.onView("list")}
          >
            <ListIcon size={15} />
          </button>
          <button
            type="button"
            class={toggleClass(props.view === "grid")}
            title="网格视图"
            onClick={() => props.onView("grid")}
          >
            <GridIcon size={15} />
          </button>
        </div>

        <button
          type="button"
          class={styles.iconButton}
          title="刷新"
          disabled={props.loading}
          onClick={props.onRefresh}
        >
          <RefreshIcon size={15} />
        </button>

        <Button variant="secondary" size="sm" onClick={props.onCreateFolder}>
          <PlusIcon size={15} />
          新建文件夹
        </Button>

        <Button variant="primary" size="sm" onClick={() => fileInput?.click()}>
          <UploadIcon size={15} />
          上传
        </Button>

        <Button variant="ghost" size="sm" title="上传文件夹" onClick={() => folderInput?.click()}>
          <UploadIcon size={15} />
        </Button>
      </div>

      <input
        ref={(el) => {
          fileInput = el;
        }}
        type="file"
        multiple
        class={styles.hidden}
        onChange={(event) => readFiles(event, props.onPickFiles)}
      />
      <input
        ref={(el) => {
          folderInput = el;
        }}
        type="file"
        multiple
        webkitdirectory
        class={styles.hidden}
        onChange={(event) => readFiles(event, props.onPickFolder)}
      />
    </div>
  );
}
