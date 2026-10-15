import { Show, createSignal, onSettled } from "solid-js";

import { UploadCloudIcon } from "~/components/ui/icons";
import type { UploadCandidate } from "~/lib/upload/store";

import styles from "./drop-zone.module.css";

export type DropZoneProps = {
  onDrop: (candidates: UploadCandidate[]) => void;
};

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const step = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(all);
            return;
          }
          all.push(...batch);
          step();
        },
        (error) => reject(error),
      );
    };
    step();
  });
}

async function collectFromEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: UploadCandidate[],
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as FileSystemFileEntry).file(resolve, reject);
    });
    out.push({ file, relativePath: prefix ? `${prefix}/${entry.name}` : entry.name });
    return;
  }

  if (entry.isDirectory) {
    const dirPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const children = await readEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const child of children) {
      await collectFromEntry(child, dirPath, out);
    }
  }
}

async function collectFromDataTransfer(data: DataTransfer): Promise<UploadCandidate[]> {
  const items = Array.from(data.items).filter((item) => item.kind === "file");
  const supportsEntry = items.some((item) => typeof item.webkitGetAsEntry === "function");

  if (!supportsEntry) {
    return Array.from(data.files).map((file) => ({ file }));
  }

  const roots: FileSystemEntry[] = [];
  for (const item of items) {
    const entry = item.webkitGetAsEntry();
    if (entry) {
      roots.push(entry);
    }
  }

  const out: UploadCandidate[] = [];
  for (const entry of roots) {
    await collectFromEntry(entry, "", out);
  }
  return out;
}

function hasFiles(event: DragEvent): boolean {
  const types = event.dataTransfer?.types;
  return types ? Array.from(types).includes("Files") : false;
}

/** 全窗口拖拽上传覆盖层：拖入文件 / 文件夹时展示提示，松开后产出候选列表。 */
export function DropZone(props: DropZoneProps) {
  const [dragging, setDragging] = createSignal(false);
  let depth = 0;

  onSettled(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }
      depth += 1;
      setDragging(true);
    };

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
    };

    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        setDragging(false);
      }
    };

    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const data = event.dataTransfer;
      if (!data) {
        return;
      }
      void collectFromDataTransfer(data).then((candidates) => {
        if (candidates.length > 0) {
          props.onDrop(candidates);
        }
      });
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);

    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  });

  return (
    <Show when={dragging()}>
      <div class={styles.overlay}>
        <div class={styles.hint}>
          <UploadCloudIcon size={36} />
          <span>松开鼠标即可上传</span>
          <span class={styles.sub}>支持文件与整个文件夹</span>
        </div>
      </div>
    </Show>
  );
}
