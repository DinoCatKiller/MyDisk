/**
 * 上传池编排器（xstate v5 核心，框架无关）。
 *
 * 职责（X1 §3.2）：
 * - 用 `spawn` 为每个入队文件创建 `uploadItemMachine` 子 actor（id = fingerprint，不重复 spawn）。
 * - 调度：`!globalPaused && active 子 actor 数 < maxParallelFiles && queue 非空` → 出队发 `GRANT`。
 *   并发额度以「active 子 actor 计数」实时推导，不单独维护计数器。
 * - 全局控制：`PAUSE_ALL` / `RESUME_ALL` / `STOP_ALL` / `CLEAR_DONE`。
 */
import { assign, enqueueActions, setup } from "xstate";

import { uploadItemMachine, type ItemInput, type UploadItemActorRef } from "./item.machine";

const DEFAULT_MAX_PARALLEL_FILES = 3;

export type UploadPoolContext = {
  maxParallelFiles: number;
  queue: string[];
  items: Map<string, UploadItemActorRef>;
  globalPaused: boolean;
};

export type UploadPoolEvent =
  | { type: "ENQUEUE"; id: string; input: ItemInput }
  | { type: "CHILD_QUEUED"; id: string }
  | { type: "CHILD_ACTIVE"; id: string }
  | { type: "CHILD_RELEASE"; id: string }
  | { type: "CHILD_DONE"; id: string }
  | { type: "CHILD_CANCELED"; id: string }
  | { type: "ITEM_PAUSE"; id: string }
  | { type: "ITEM_RESUME"; id: string }
  | { type: "ITEM_STOP"; id: string }
  | { type: "ITEM_RETRY"; id: string }
  | { type: "PAUSE_ALL" }
  | { type: "RESUME_ALL" }
  | { type: "STOP_ALL" }
  | { type: "CLEAR_DONE" };

export type UploadPoolInput = {
  maxParallelFiles?: number;
};

function activeCount(items: Map<string, UploadItemActorRef>): number {
  let count = 0;
  for (const ref of items.values()) {
    if (ref.getSnapshot().matches("active")) {
      count += 1;
    }
  }
  return count;
}

export const uploadPoolMachine = setup({
  types: {
    context: {} as UploadPoolContext,
    events: {} as UploadPoolEvent,
    input: {} as UploadPoolInput,
  },
  actors: {
    uploadItem: uploadItemMachine,
  },
  actions: {
    /** 出队一格并授予额度（有额度时才动作）。 */
    dispatchQueue: enqueueActions(({ context, enqueue }) => {
      if (context.globalPaused || context.queue.length === 0) {
        return;
      }
      if (activeCount(context.items) >= context.maxParallelFiles) {
        return;
      }
      const nextId = context.queue[0];
      const ref = nextId ? context.items.get(nextId) : undefined;
      enqueue.assign({ queue: context.queue.slice(1) });
      if (ref && ref.getSnapshot().status === "active") {
        enqueue.sendTo(ref, { type: "GRANT" });
      }
    }),
  },
}).createMachine({
  id: "uploadPool",
  initial: "running",
  context: ({ input }) => ({
    maxParallelFiles: input.maxParallelFiles ?? DEFAULT_MAX_PARALLEL_FILES,
    queue: [],
    items: new Map<string, UploadItemActorRef>(),
    globalPaused: false,
  }),
  states: {
    running: {
      on: {
        ENQUEUE: {
          actions: [
            enqueueActions(({ context, event, enqueue }) => {
              if (context.items.has(event.id)) {
                return;
              }
              enqueue.assign({
                items: ({ context: current, spawn }) => {
                  const items = new Map(current.items);
                  items.set(event.id, spawn("uploadItem", { input: event.input }));
                  return items;
                },
                queue: ({ context: current }) =>
                  current.queue.includes(event.id) ? current.queue : [...current.queue, event.id],
              });
            }),
            "dispatchQueue",
          ],
        },
        CHILD_QUEUED: {
          actions: [
            enqueueActions(({ context, event, enqueue }) => {
              if (context.queue.includes(event.id)) {
                return;
              }
              enqueue.assign({ queue: [...context.queue, event.id] });
            }),
            "dispatchQueue",
          ],
        },
        CHILD_ACTIVE: { actions: ["dispatchQueue"] },
        CHILD_RELEASE: { actions: ["dispatchQueue"] },
        CHILD_DONE: { actions: ["dispatchQueue"] },
        CHILD_CANCELED: {
          actions: [
            assign({
              items: ({ context, event }) => {
                const items = new Map(context.items);
                items.delete(event.id);
                return items;
              },
              queue: ({ context, event }) => context.queue.filter((id) => id !== event.id),
            }),
            "dispatchQueue",
          ],
        },
        ITEM_PAUSE: {
          actions: enqueueActions(({ context, event, enqueue }) => {
            const ref = context.items.get(event.id);
            if (ref) {
              enqueue.sendTo(ref, { type: "PAUSE" });
            }
          }),
        },
        ITEM_RESUME: {
          actions: enqueueActions(({ context, event, enqueue }) => {
            const ref = context.items.get(event.id);
            if (ref) {
              enqueue.sendTo(ref, { type: "RESUME" });
            }
          }),
        },
        ITEM_STOP: {
          actions: enqueueActions(({ context, event, enqueue }) => {
            const ref = context.items.get(event.id);
            if (ref) {
              enqueue.sendTo(ref, { type: "STOP" });
            }
          }),
        },
        ITEM_RETRY: {
          actions: enqueueActions(({ context, event, enqueue }) => {
            const ref = context.items.get(event.id);
            if (ref) {
              enqueue.sendTo(ref, { type: "RETRY" });
            }
          }),
        },
        PAUSE_ALL: {
          actions: [
            assign({ globalPaused: true }),
            enqueueActions(({ context, enqueue }) => {
              for (const ref of context.items.values()) {
                if (ref.getSnapshot().matches("active")) {
                  enqueue.sendTo(ref, { type: "PAUSE" });
                }
              }
            }),
          ],
        },
        RESUME_ALL: {
          actions: [assign({ globalPaused: false }), "dispatchQueue"],
        },
        STOP_ALL: {
          actions: [
            assign({ globalPaused: false }),
            enqueueActions(({ context, enqueue }) => {
              for (const ref of context.items.values()) {
                if (ref.getSnapshot().status === "active") {
                  enqueue.sendTo(ref, { type: "STOP" });
                }
              }
            }),
          ],
        },
        CLEAR_DONE: {
          actions: assign({
            items: ({ context }) => {
              const items = new Map(context.items);
              for (const [id, ref] of items) {
                if (ref.getSnapshot().matches("done")) {
                  items.delete(id);
                }
              }
              return items;
            },
          }),
        },
      },
    },
  },
});
