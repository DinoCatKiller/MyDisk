import { Show } from "solid-js";

import type { FileNodeRow } from "@MyDISK/db/schema";

import {
  DownloadIcon,
  FileIcon,
  FileImageIcon,
  FolderIcon,
  FolderOpenIcon,
  InfoIcon,
  PencilIcon,
  StarIcon,
  TrashIcon,
} from "~/components/ui/icons";
import { formatBytes, formatDateTime } from "~/lib/format";

import styles from "./file-row.module.css";

export type FileView = "list" | "grid";

export type FileRowProps = {
  node: FileNodeRow;
  view: FileView;
  onOpen: (node: FileNodeRow) => void;
  onDownload: (node: FileNodeRow) => void;
  onRename: (node: FileNodeRow) => void;
  onDelete: (node: FileNodeRow) => void;
  onFavorite: (node: FileNodeRow) => void;
  onMove: (node: FileNodeRow) => void;
  onProperties: (node: FileNodeRow) => void;
};

export function FileRow(props: FileRowProps) {
  const isFolder = () => props.node.type === "folder";
  const isImage = () => !isFolder() && (props.node.mime ?? "").startsWith("image/");
  const sizeLabel = () => (isFolder() ? "—" : formatBytes(props.node.size));

  const icon = () => {
    if (isFolder()) {
      return <FolderIcon size={20} class={styles.folderIcon} />;
    }
    if (isImage()) {
      return <FileImageIcon size={20} class={styles.imageIcon} />;
    }
    return <FileIcon size={20} class={styles.fileIcon} />;
  };

  const activate = () => {
    if (isFolder()) {
      props.onOpen(props.node);
    } else {
      props.onDownload(props.node);
    }
  };

  const actions = () => (
    <span class={styles.actions}>
      <button
        type="button"
        class={`${styles.action} ${props.node.isFavorite ? styles.starActive : ""}`}
        title={props.node.isFavorite ? "取消收藏" : "收藏"}
        onClick={(event) => {
          event.stopPropagation();
          props.onFavorite(props.node);
        }}
      >
        <StarIcon size={15} />
      </button>
      <Show when={!isFolder()}>
        <button
          type="button"
          class={styles.action}
          title="下载"
          onClick={(event) => {
            event.stopPropagation();
            props.onDownload(props.node);
          }}
        >
          <DownloadIcon size={15} />
        </button>
      </Show>
      <button
        type="button"
        class={styles.action}
        title="重命名"
        onClick={(event) => {
          event.stopPropagation();
          props.onRename(props.node);
        }}
      >
        <PencilIcon size={15} />
      </button>
      <button
        type="button"
        class={styles.action}
        title="移动"
        onClick={(event) => {
          event.stopPropagation();
          props.onMove(props.node);
        }}
      >
        <FolderOpenIcon size={15} />
      </button>
      <button
        type="button"
        class={styles.action}
        title="属性"
        onClick={(event) => {
          event.stopPropagation();
          props.onProperties(props.node);
        }}
      >
        <InfoIcon size={15} />
      </button>
      <button
        type="button"
        class={`${styles.action} ${styles.actionDanger}`}
        title="删除"
        onClick={(event) => {
          event.stopPropagation();
          props.onDelete(props.node);
        }}
      >
        <TrashIcon size={15} />
      </button>
    </span>
  );

  return (
    <Show
      when={props.view === "list"}
      fallback={
        <div class={styles.card}>
          <button type="button" class={styles.cardMain} onClick={activate}>
            <span class={styles.cardIcon}>{icon()}</span>
            <span class={styles.cardName} title={props.node.name}>
              {props.node.name}
            </span>
            <span class={styles.cardMeta}>{sizeLabel()}</span>
          </button>
          {actions()}
        </div>
      }
    >
      <div class={styles.row}>
        <button type="button" class={styles.main} onClick={activate}>
          <span class={styles.icon}>{icon()}</span>
          <span class={styles.name} title={props.node.name}>
            {props.node.name}
          </span>
        </button>
        <span class={styles.size}>{sizeLabel()}</span>
        <span class={styles.time}>{formatDateTime(props.node.updatedAt)}</span>
        {actions()}
      </div>
    </Show>
  );
}
