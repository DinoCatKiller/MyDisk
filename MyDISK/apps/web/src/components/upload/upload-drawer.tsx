import { For, Show } from "solid-js";

import { Button } from "~/components/ui/button";
import { CheckIcon, PauseIcon, PlayIcon, UploadCloudIcon, XIcon } from "~/components/ui/icons";
import { formatBytes } from "~/lib/format";
import {
  clearDone,
  closeUploadDrawer,
  pauseAll,
  pauseItem,
  resumeAll,
  resumeItem,
  retryItem,
  stopAll,
  stopItem,
  uploadDrawerOpen,
  uploadItems,
  uploadSummary,
  type UploadItemView,
} from "~/lib/upload/store";

import styles from "./upload-drawer.module.css";

function stageLabel(stage: UploadItemView["stage"]): string {
  switch (stage) {
    case "queued":
      return "排队中";
    case "preparing":
      return "准备中";
    case "transferring":
      return "上传中";
    case "merging":
      return "合并中";
    case "paused":
      return "已暂停";
    case "failed":
      return "失败";
    case "done":
      return "已完成";
    case "canceled":
      return "已取消";
    default:
      return "";
  }
}

function UploadItemRow(props: { item: UploadItemView }) {
  const percent = () => Math.round(Math.min(1, Math.max(0, props.item.progress)) * 100);
  const busy = () =>
    props.item.stage === "queued" ||
    props.item.stage === "preparing" ||
    props.item.stage === "transferring" ||
    props.item.stage === "merging";

  const rowClass = () =>
    [styles.item, props.item.stage === "done" ? styles.itemDone : ""].filter(Boolean).join(" ");

  return (
    <li class={rowClass()}>
      <div class={styles.itemTop}>
        <span class={styles.itemName} title={props.item.name}>
          {props.item.name}
        </span>

        <span class={styles.itemActions}>
          <Show when={props.item.stage === "done"}>
            <span class={styles.doneMark} title="已完成">
              <CheckIcon size={15} />
            </span>
          </Show>

          <Show when={busy() || props.item.stage === "paused"}>
            <Show
              when={props.item.stage === "paused"}
              fallback={
                <button
                  type="button"
                  class={styles.iconButton}
                  title="暂停"
                  onClick={() => pauseItem(props.item.id)}
                >
                  <PauseIcon size={15} />
                </button>
              }
            >
              <button
                type="button"
                class={styles.iconButton}
                title="继续"
                onClick={() => resumeItem(props.item.id)}
              >
                <PlayIcon size={15} />
              </button>
            </Show>
          </Show>

          <Show when={props.item.stage === "failed"}>
            <button
              type="button"
              class={styles.iconButton}
              title="重试"
              onClick={() => retryItem(props.item.id)}
            >
              <PlayIcon size={15} />
            </button>
          </Show>

          <Show when={props.item.stage !== "done" && props.item.stage !== "canceled"}>
            <button
              type="button"
              class={styles.iconButton}
              title="停止"
              onClick={() => stopItem(props.item.id)}
            >
              <XIcon size={15} />
            </button>
          </Show>
        </span>
      </div>

      <div class={styles.progressTrack}>
        <div
          class={[styles.progressBar, props.item.stage === "failed" ? styles.progressFailed : ""]
            .filter(Boolean)
            .join(" ")}
          style={{ width: `${percent()}%` }}
        />
      </div>

      <div class={styles.itemMeta}>
        <span>
          {formatBytes(props.item.uploadedBytes)} / {formatBytes(props.item.size)}
        </span>
        <span
          class={[
            styles.itemStage,
            props.item.stage === "failed" ? styles.stageFailed : "",
            props.item.stage === "done" ? styles.stageDone : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          {stageLabel(props.item.stage)}
          <Show when={busy()}> · {percent()}%</Show>
        </span>
      </div>

      <Show when={props.item.error}>
        <div class={styles.itemError}>{props.item.error}</div>
      </Show>
    </li>
  );
}

export function UploadDrawer() {
  const summary = () => uploadSummary();
  const items = () => uploadItems();
  const pending = () =>
    items().filter((item) => item.stage !== "done" && item.stage !== "canceled");
  const hasDone = () => items().some((item) => item.stage === "done");
  const anyRunning = () => pending().some((item) => item.stage !== "paused");

  return (
    <Show when={uploadDrawerOpen()}>
      <aside class={styles.drawer} aria-label="上传队列">
        <header class={styles.header}>
          <div class={styles.headerTitle}>
            <UploadCloudIcon size={18} />
            <span>上传队列</span>
            <Show when={summary().total > 0}>
              <span class={styles.counter}>
                {summary().done}/{summary().total}
              </span>
            </Show>
          </div>

          <div class={styles.headerActions}>
            <Show when={anyRunning()}>
              <Button size="sm" variant="ghost" title="全部暂停" onClick={() => pauseAll()}>
                <PauseIcon size={15} />
              </Button>
            </Show>
            <Show when={!anyRunning() && pending().length > 0}>
              <Button size="sm" variant="ghost" title="全部继续" onClick={() => resumeAll()}>
                <PlayIcon size={15} />
              </Button>
            </Show>
            <Show when={pending().length > 0}>
              <Button size="sm" variant="ghost" title="全部停止" onClick={() => stopAll()}>
                <XIcon size={15} />
              </Button>
            </Show>
            <Show when={hasDone()}>
              <Button size="sm" variant="ghost" title="清除已完成" onClick={() => clearDone()}>
                清除已完成
              </Button>
            </Show>
            <Button size="sm" variant="ghost" title="收起" onClick={() => closeUploadDrawer()}>
              <XIcon size={15} />
            </Button>
          </div>
        </header>

        <Show when={summary().total > 0}>
          <div class={styles.overall}>
            <div class={styles.overallTrack}>
              <div
                class={styles.overallBar}
                style={{ width: `${Math.round(summary().progress * 100)}%` }}
              />
            </div>
            <span class={styles.overallLabel}>{Math.round(summary().progress * 100)}%</span>
          </div>
        </Show>

        <Show
          when={items().length > 0}
          fallback={<div class={styles.empty}>暂无上传任务，拖拽文件到窗口即可上传。</div>}
        >
          <ul class={styles.list}>
            <For each={items()}>{(item) => <UploadItemRow item={item} />}</For>
          </ul>
        </Show>
      </aside>
    </Show>
  );
}
