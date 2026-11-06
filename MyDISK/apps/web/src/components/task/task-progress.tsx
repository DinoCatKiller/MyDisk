import { Show, createSignal, onCleanup, onSettled } from "solid-js";

import type { TaskView } from "@MyDISK/api/schemas/task";

import { client } from "~/utils/orpc";

import styles from "./task-progress.module.css";

export type TaskProgressProps = {
  taskId: string;
  onDone: (task: TaskView) => void;
};

/** 轮询 `task.get` 展示进度；终态时回调一次并停止轮询。 */
export function TaskProgress(props: TaskProgressProps) {
  const [task, setTask] = createSignal<TaskView | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const schedule = () => {
    if (!stopped) {
      timer = setTimeout(() => void poll(), 1200);
    }
  };

  const poll = async () => {
    try {
      const view = await client.task.get({ id: props.taskId });
      setTask(view);
      if (view.status === "pending" || view.status === "running") {
        schedule();
      } else {
        stopped = true;
        props.onDone(view);
      }
    } catch {
      schedule();
    }
  };

  onSettled(() => {
    void poll();
  });

  onCleanup(() => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  });

  const cancel = () => {
    void client.task.cancel({ id: props.taskId }).catch(() => undefined);
  };

  return (
    <div class={styles.card}>
      <div class={styles.head}>
        <span class={styles.title}>{task()?.title ?? "任务排队中…"}</span>
        <span class={styles.percent}>{task()?.progress ?? 0}%</span>
        <button type="button" class={styles.cancel} onClick={cancel}>
          取消
        </button>
      </div>
      <div class={styles.bar}>
        <div class={styles.fill} style={{ width: `${task()?.progress ?? 0}%` }} />
      </div>
      <Show when={task()?.status === "failed" && task()?.error}>
        <div class={styles.error}>{task()?.error}</div>
      </Show>
    </div>
  );
}
