import { useNavigate, useParams } from "@solidjs/router";
import { Show, createEffect, createSignal, onSettled } from "solid-js";

import type { FileRouterNode } from "@MyDISK/api/routers/file";

import { DropZone } from "~/components/file/drop-zone";
import { FileList } from "~/components/file/file-list";
import type { FileView } from "~/components/file/file-row";
import { Toolbar, type SortField, type SortOrder } from "~/components/file/toolbar";
import { Protected } from "~/components/layout/protected";
import { Alert } from "~/components/ui/alert";
import { UploadDrawer } from "~/components/upload/upload-drawer";
import { sessionUser } from "~/lib/session";
import { enqueueCandidates, initUploadStore, type UploadCandidate } from "~/lib/upload/store";
import { client } from "~/utils/orpc";

import styles from "./page.module.css";

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function FilesPage() {
  const navigate = useNavigate();
  const params = useParams<{ path?: string }>();

  const [items, setItems] = createSignal<FileRouterNode[]>([]);
  const [path, setPath] = createSignal<FileRouterNode[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [keyword, setKeyword] = createSignal("");
  const [sortField, setSortField] = createSignal<SortField>("name");
  const [sortOrder, setSortOrder] = createSignal<SortOrder>("asc");
  const [view, setView] = createSignal<FileView>("list");
  const [reloadTick, setReloadTick] = createSignal(0);

  /** 路由段即节点 ID：取最后一段作为当前目录（裸 `/files` 为空）。 */
  const currentId = () => {
    const parts = (params.path ?? "").split("/").filter(Boolean);
    return parts.length > 0 ? (parts[parts.length - 1] ?? null) : null;
  };

  const reload = () => setReloadTick((tick) => tick + 1);

  createEffect(
    () => ({
      id: currentId(),
      tick: reloadTick(),
      query: keyword(),
      field: sortField(),
      order: sortOrder(),
    }),
    (request) => {
      setLoading(true);
      setError("");
      void client.file
        .list({
          parentId: request.id,
          keyword: request.query || null,
          sort: { field: request.field, order: request.order },
          page: 1,
          pageSize: 200,
        })
        .then((result) => setItems(result.items))
        .catch((loadError: unknown) => setError(messageOf(loadError, "读取目录失败")))
        .finally(() => setLoading(false));
    },
  );

  createEffect(
    () => currentId(),
    (id) => {
      if (!id) {
        setPath([]);
        return;
      }
      void client.file
        .path({ nodeId: id })
        .then((chain) => setPath(chain))
        .catch(() => setPath([]));
    },
  );

  onSettled(() => {
    if (sessionUser()?.mustChangePassword) {
      navigate("/settings/security?force=1");
      return;
    }
    void initUploadStore();
  });

  const openFolder = (node: FileRouterNode) => {
    navigate(`/files/${node.id}`);
  };

  const download = (node: FileRouterNode) => {
    void client.preview
      .url({ nodeId: node.id, inline: true, download: true })
      .then((result) => {
        const anchor = document.createElement("a");
        anchor.href = result.url;
        anchor.download = node.name;
        anchor.rel = "noreferrer";
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
      })
      .catch((downloadError: unknown) => setError(messageOf(downloadError, "下载失败")));
  };

  const createFolder = () => {
    const name = window.prompt("新建文件夹名称");
    if (!name) {
      return;
    }
    void client.file
      .mkdir({ parentId: currentId(), name })
      .then(() => reload())
      .catch((mkdirError: unknown) => setError(messageOf(mkdirError, "新建文件夹失败")));
  };

  const rename = (node: FileRouterNode) => {
    const name = window.prompt("重命名", node.name);
    if (!name || name === node.name) {
      return;
    }
    void client.file
      .rename({ nodeId: node.id, name })
      .then(() => reload())
      .catch((renameError: unknown) => setError(messageOf(renameError, "重命名失败")));
  };

  const remove = (node: FileRouterNode) => {
    if (!window.confirm(`确定将「${node.name}」移入回收站？`)) {
      return;
    }
    void client.file
      .remove({ nodeIds: [node.id] })
      .then(() => reload())
      .catch((removeError: unknown) => setError(messageOf(removeError, "删除失败")));
  };

  const uploadCandidates = (candidates: UploadCandidate[]) => {
    void enqueueCandidates(candidates, { parentId: currentId() });
  };

  return (
    <Protected title="全部文件" description="浏览、上传与管理文件">
      <div class={styles.page}>
        <Toolbar
          path={path()}
          keyword={keyword()}
          onKeyword={setKeyword}
          sortField={sortField()}
          sortOrder={sortOrder()}
          onSortField={setSortField}
          onToggleOrder={() => setSortOrder((order) => (order === "asc" ? "desc" : "asc"))}
          view={view()}
          onView={setView}
          loading={loading()}
          onCreateFolder={createFolder}
          onPickFiles={(files) => uploadCandidates(files.map((file) => ({ file })))}
          onPickFolder={(files) =>
            uploadCandidates(
              files.map((file) => ({ file, relativePath: file.webkitRelativePath || null })),
            )
          }
          onRefresh={reload}
        />

        <Show when={error()}>
          <Alert variant="error">{error()}</Alert>
        </Show>

        <FileList
          items={items()}
          view={view()}
          loading={loading()}
          onOpen={openFolder}
          onDownload={download}
          onRename={rename}
          onDelete={remove}
        />
      </div>

      <UploadDrawer />
      <DropZone onDrop={uploadCandidates} />
    </Protected>
  );
}
