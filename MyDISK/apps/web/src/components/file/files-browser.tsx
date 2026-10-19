import { useNavigate } from "@tanstack/solid-router";
import { Show, createEffect, createSignal, onSettled } from "solid-js";

import type { FileNodeRow } from "@MyDISK/db/schema";

import { DropZone } from "~/components/file/drop-zone";
import { FileList } from "~/components/file/file-list";
import type { FileView } from "~/components/file/file-row";
import { Toolbar, type SortField, type SortOrder } from "~/components/file/toolbar";
import { Protected } from "~/components/layout/protected";
import { Alert } from "~/components/ui/alert";
import { UploadDrawer } from "~/components/upload/upload-drawer";
import type { FilesLoaderData } from "~/lib/files-loader";
import { useSession } from "~/lib/session";
import { enqueueCandidates, initUploadStore, type UploadCandidate } from "~/lib/upload/store";
import { client } from "~/utils/orpc";

import styles from "./files-browser.module.css";

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export type FilesBrowserProps = {
  /** 路由 loader 装载的数据（`D8` 首屏 SSR + 导航时服务端取数）。 */
  data: FilesLoaderData;
};

/** `/files` 与 `/files/<id>/...` 共用的文件浏览器主体。 */
export function FilesBrowser(props: FilesBrowserProps) {
  const navigate = useNavigate();
  const session = useSession();

  /** 客户端筛选 / 排序 / 刷新后的覆盖结果；`null` 表示仍用 loader 数据。 */
  const [override, setOverride] = createSignal<FileNodeRow[] | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [keyword, setKeyword] = createSignal("");
  const [sortField, setSortField] = createSignal<SortField>("name");
  const [sortOrder, setSortOrder] = createSignal<SortOrder>("asc");
  const [view, setView] = createSignal<FileView>("list");
  const [reloadTick, setReloadTick] = createSignal(0);

  /** 当前目录节点 ID（由 loader 决定：裸 `/files` 为 null）。 */
  const parentId = () => props.data.parentId;
  /** 优先展示客户端覆盖结果，否则用 loader 数据。 */
  const items = () => override() ?? props.data.items;
  const path = () => props.data.path;
  const shownError = () => error() || props.data.error;

  const reload = () => setReloadTick((tick) => tick + 1);

  /** loader 数据变化（服务端重新装载）时丢弃本地覆盖，回到首屏真值。 */
  createEffect(
    () => props.data,
    () => {
      setOverride(null);
      setError("");
    },
  );

  /**
   * 关键词 / 排序 / 手动刷新变化后客户端重新取数。
   * 目录切换交给路由 loader，因此这里不依赖 `parentId`（只在 effect 内读取）。
   */
  createEffect(
    () => ({
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
          parentId: parentId(),
          keyword: request.query || null,
          sort: { field: request.field, order: request.order },
          page: 1,
          pageSize: 200,
        })
        .then((result) => setOverride(result.items))
        .catch((loadError: unknown) => setError(messageOf(loadError, "读取目录失败")))
        .finally(() => setLoading(false));
    },
    { defer: true },
  );

  onSettled(() => {
    if (session()?.mustChangePassword) {
      navigate({ to: "/settings/security", search: { force: true } });
      return;
    }
    void initUploadStore();
  });

  const openFolder = (node: FileNodeRow) => {
    navigate({ to: "/files/$", params: { _splat: node.id } });
  };

  const download = (node: FileNodeRow) => {
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
      .mkdir({ parentId: parentId(), name })
      .then(() => reload())
      .catch((mkdirError: unknown) => setError(messageOf(mkdirError, "新建文件夹失败")));
  };

  const rename = (node: FileNodeRow) => {
    const name = window.prompt("重命名", node.name);
    if (!name || name === node.name) {
      return;
    }
    void client.file
      .rename({ nodeId: node.id, name })
      .then(() => reload())
      .catch((renameError: unknown) => setError(messageOf(renameError, "重命名失败")));
  };

  const remove = (node: FileNodeRow) => {
    if (!window.confirm(`确定将「${node.name}」移入回收站？`)) {
      return;
    }
    void client.file
      .remove({ nodeIds: [node.id] })
      .then(() => reload())
      .catch((removeError: unknown) => setError(messageOf(removeError, "删除失败")));
  };

  const uploadCandidates = (candidates: UploadCandidate[]) => {
    void enqueueCandidates(candidates, { parentId: parentId() });
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

        <Show when={shownError()}>
          <Alert variant="error">{shownError()}</Alert>
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
