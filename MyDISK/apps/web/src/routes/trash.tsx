import { createFileRoute, useRouter } from "@tanstack/solid-router";
import { For, Show, createSignal } from "solid-js";

import type { FileNode } from "@MyDISK/api/schemas/file";

import { Protected } from "~/components/layout/protected";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { FolderIcon, FileIcon, FileImageIcon, RotateIcon, TrashIcon } from "~/components/ui/icons";
import { formatBytes, formatDateTime } from "~/lib/format";
import { fetchTrash } from "~/server/fns";
import { client } from "~/utils/orpc";

export const Route = createFileRoute("/trash")({
  loader: () => fetchTrash({ data: { page: 1, pageSize: 200 } }),
  component: TrashPage,
});

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function TrashPage() {
  const router = useRouter();
  const data = Route.useLoaderData();
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      // 让 loader 重新拉取回收站列表
      await router.invalidate();
    } catch (runError) {
      setError(messageOf(runError, "操作失败"));
    } finally {
      setBusy(false);
    }
  };

  const restore = (node: FileNode) => run(() => client.file.restore({ nodeIds: [node.id] }));

  const purge = (node: FileNode) => {
    if (!window.confirm(`彻底删除「${node.name}」？该操作不可恢复。`)) {
      return;
    }
    return run(() => client.file.purge({ nodeIds: [node.id] }));
  };

  const emptyTrash = () => {
    if (!window.confirm("清空回收站？所有条目将被彻底删除，不可恢复。")) {
      return;
    }
    return run(() => client.file.emptyTrash({}));
  };

  const icon = (node: FileNode) => {
    if (node.type === "folder") {
      return <FolderIcon size={18} />;
    }
    if ((node.mime ?? "").startsWith("image/")) {
      return <FileImageIcon size={18} />;
    }
    return <FileIcon size={18} />;
  };

  return (
    <Protected
      title="回收站"
      description="已删除的文件与文件夹，保留 30 天"
      actions={
        <Show when={data().items.length > 0}>
          <Button variant="danger" size="sm" disabled={busy()} onClick={() => void emptyTrash()}>
            <TrashIcon size={15} />
            清空回收站
          </Button>
        </Show>
      }
    >
      <div class="flex flex-col gap-4">
        <Show when={error()}>
          <Alert variant="error">{error()}</Alert>
        </Show>

        <Show
          when={data().items.length > 0}
          fallback={
            <div class="rounded-lg border border-[var(--md-border)] bg-white py-16 text-center text-sm text-[var(--md-text-muted)]">
              回收站为空
            </div>
          }
        >
          <div class="overflow-hidden rounded-lg border border-[var(--md-border)] bg-white">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-[var(--md-border)] text-left text-xs text-[var(--md-text-muted)]">
                  <th class="px-4 py-2.5 font-medium">名称</th>
                  <th class="px-4 py-2.5 font-medium">大小</th>
                  <th class="px-4 py-2.5 font-medium">删除时间</th>
                  <th class="px-4 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                <For each={data().items}>
                  {(node) => (
                    <tr class="border-b border-[var(--md-border)] last:border-b-0">
                      <td class="flex items-center gap-2 px-4 py-2.5">
                        <span class="text-[var(--md-text-muted)]">{icon(node)}</span>
                        {node.name}
                      </td>
                      <td class="px-4 py-2.5 text-[var(--md-text-muted)]">
                        {node.type === "folder" ? "—" : formatBytes(node.size)}
                      </td>
                      <td class="px-4 py-2.5 text-[var(--md-text-muted)]">
                        {formatDateTime(node.deletedAt ?? node.updatedAt)}
                      </td>
                      <td class="px-4 py-2.5 text-right">
                        <div class="inline-flex gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy()}
                            onClick={() => void restore(node)}
                          >
                            <RotateIcon size={14} />
                            还原
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={busy()}
                            onClick={() => void purge(node)}
                          >
                            彻底删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </div>
    </Protected>
  );
}
