import { createFileRoute, useNavigate, useRouter } from "@tanstack/solid-router";
import { For, Show, createSignal } from "solid-js";

import type { FileNode } from "@MyDISK/api/schemas/file";

import { Protected } from "~/components/layout/protected";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  ExternalLinkIcon,
  FolderIcon,
  FileIcon,
  FileImageIcon,
  StarIcon,
} from "~/components/ui/icons";
import { formatBytes, formatDateTime } from "~/lib/format";
import { fetchFavorites } from "~/server/fns";
import { client } from "~/utils/orpc";

export const Route = createFileRoute("/favorites")({
  loader: () => fetchFavorites({ data: { page: 1, pageSize: 200 } }),
  component: FavoritesPage,
});

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function FavoritesPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const data = Route.useLoaderData();
  const [error, setError] = createSignal("");
  const [busy, setBusy] = createSignal(false);

  const openLocation = (node: FileNode) => {
    // 收藏项可能在子目录：跳到其所在目录；根目录条目回到 /files
    if (node.parentId) {
      void navigate({ to: "/files/$", params: { _splat: node.parentId } });
    } else {
      void navigate({ to: "/files" });
    }
  };

  const unfavorite = async (node: FileNode) => {
    setBusy(true);
    setError("");
    try {
      await client.file.unfavorite({ nodeId: node.id });
      await router.invalidate();
    } catch (unfavoriteError) {
      setError(messageOf(unfavoriteError, "取消收藏失败"));
    } finally {
      setBusy(false);
    }
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
    <Protected title="收藏" description="被星标的文件与文件夹">
      <div class="flex flex-col gap-4">
        <Show when={error()}>
          <Alert variant="error">{error()}</Alert>
        </Show>

        <Show
          when={data().items.length > 0}
          fallback={
            <div class="rounded-lg border border-[var(--md-border)] bg-white py-16 text-center text-sm text-[var(--md-text-muted)]">
              还没有收藏条目 —— 在文件列表点击星标即可收藏
            </div>
          }
        >
          <div class="overflow-hidden rounded-lg border border-[var(--md-border)] bg-white">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-[var(--md-border)] text-left text-xs text-[var(--md-text-muted)]">
                  <th class="px-4 py-2.5 font-medium">名称</th>
                  <th class="px-4 py-2.5 font-medium">大小</th>
                  <th class="px-4 py-2.5 font-medium">修改时间</th>
                  <th class="px-4 py-2.5 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                <For each={data().items}>
                  {(node) => (
                    <tr class="border-b border-[var(--md-border)] last:border-b-0">
                      <td class="flex items-center gap-2 px-4 py-2.5">
                        <span class="text-[#f5a623]">
                          <StarIcon size={15} />
                        </span>
                        <span class="text-[var(--md-text-muted)]">{icon(node)}</span>
                        {node.name}
                      </td>
                      <td class="px-4 py-2.5 text-[var(--md-text-muted)]">
                        {node.type === "folder" ? "—" : formatBytes(node.size)}
                      </td>
                      <td class="px-4 py-2.5 text-[var(--md-text-muted)]">
                        {formatDateTime(node.updatedAt)}
                      </td>
                      <td class="px-4 py-2.5 text-right">
                        <div class="inline-flex gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => openLocation(node)}
                            disabled={busy()}
                          >
                            <ExternalLinkIcon size={14} />
                            所在目录
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy()}
                            onClick={() => void unfavorite(node)}
                          >
                            取消收藏
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
