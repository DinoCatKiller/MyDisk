import { useNavigate } from "@tanstack/solid-router";
import { For, Show, createEffect, createSignal, onSettled } from "solid-js";

import type { FileNode } from "@MyDISK/api/schemas/file";
import type { TaskView } from "@MyDISK/api/schemas/task";

import { DropZone } from "~/components/file/drop-zone";
import { FileList } from "~/components/file/file-list";
import type { FileView } from "~/components/file/file-row";
import { MoveDialog } from "~/components/file/move-dialog";
import { PreviewDialog } from "~/components/file/preview-dialog";
import { PropertiesPanel } from "~/components/file/properties-panel";
import { Toolbar, type SortField, type SortOrder } from "~/components/file/toolbar";
import { Protected } from "~/components/layout/protected";
import { TaskProgress } from "~/components/task/task-progress";
import { Alert } from "~/components/ui/alert";
import { UploadDrawer } from "~/components/upload/upload-drawer";
import type { FilesLoaderData } from "~/lib/files-loader";
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

  /** 客户端筛选 / 排序 / 刷新后的覆盖结果；`null` 表示仍用 loader 数据。 */
  const [override, setOverride] = createSignal<FileNode[] | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [keyword, setKeyword] = createSignal("");
  const [sortField, setSortField] = createSignal<SortField>("name");
  const [sortOrder, setSortOrder] = createSignal<SortOrder>("asc");
  const [view, setView] = createSignal<FileView>("list");
  const [reloadTick, setReloadTick] = createSignal(0);
  /** 移动对话框 / 属性面板 / 预览弹层的当前目标节点 */
  const [moving, setMoving] = createSignal<FileNode | null>(null);
  const [inspecting, setInspecting] = createSignal<FileNode | null>(null);
  const [previewing, setPreviewing] = createSignal<FileNode | null>(null);
  /** 正在轮询进度的队列任务 id */
  const [activeTasks, setActiveTasks] = createSignal<string[]>([]);

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
    void initUploadStore();
  });

  const openFolder = (node: FileNode) => {
    navigate({ to: "/files/$", params: { _splat: node.id } });
  };

  /** 把入队结果挂到进度面板；失败直接提示 */
  const track = (request: Promise<{ task: TaskView }>) => {
    void request
      .then((result) => {
        setActiveTasks((ids) => [...ids, result.task.id]);
      })
      .catch((taskError: unknown) => setError(messageOf(taskError, "创建任务失败")));
  };

  const handleTaskDone = (task: TaskView) => {
    setActiveTasks((ids) => ids.filter((id) => id !== task.id));
    if (task.status === "failed") {
      setError(task.error ?? "任务失败");
      return;
    }
    if (task.status === "completed") {
      if (task.downloadUrl) {
        const anchor = document.createElement("a");
        anchor.href = task.downloadUrl;
        anchor.rel = "noreferrer";
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
      }
      reload();
    }
  };

  const download = (node: FileNode) => {
    if (node.type === "folder") {
      track(client.archive.package({ nodeIds: [node.id] }));
      return;
    }
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

  const compress = (node: FileNode) => {
    track(client.archive.compress({ nodeIds: [node.id], targetParentId: parentId() }));
  };

  const extract = (node: FileNode) => {
    track(client.archive.extract({ nodeId: node.id, targetParentId: parentId() }));
  };

  const preview = (node: FileNode) => {
    if (node.type !== "file") {
      return;
    }
    setPreviewing(node);
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

  const rename = (node: FileNode) => {
    const name = window.prompt("重命名", node.name);
    if (!name || name === node.name) {
      return;
    }
    void client.file
      .rename({ nodeId: node.id, name })
      .then(() => reload())
      .catch((renameError: unknown) => setError(messageOf(renameError, "重命名失败")));
  };

  const toggleFavorite = (node: FileNode) => {
    const call = node.isFavorite
      ? client.file.unfavorite({ nodeId: node.id })
      : client.file.favorite({ nodeId: node.id });
    void call
      .then(() => reload())
      .catch((favoriteError: unknown) =>
        setError(messageOf(favoriteError, node.isFavorite ? "取消收藏失败" : "收藏失败")),
      );
  };

  const move = (node: FileNode, targetParentId: string | null) =>
    client.file.move({ nodeIds: [node.id], targetParentId }).then(() => {
      reload();
    });

  const remove = (node: FileNode) => {
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

        <Show when={activeTasks().length > 0}>
          <div class={styles.tasks}>
            <For each={activeTasks()}>
              {(taskId) => <TaskProgress taskId={taskId} onDone={handleTaskDone} />}
            </For>
          </div>
        </Show>

        <FileList
          items={items()}
          view={view()}
          loading={loading()}
          onOpen={openFolder}
          onPreview={preview}
          onDownload={download}
          onRename={rename}
          onDelete={remove}
          onFavorite={toggleFavorite}
          onMove={setMoving}
          onProperties={setInspecting}
          onCompress={compress}
          onExtract={extract}
        />
      </div>

      <Show when={moving()}>
        {(node) => (
          <MoveDialog
            sourceName={node().name}
            onConfirm={(targetParentId) => move(node(), targetParentId)}
            onClose={() => setMoving(null)}
          />
        )}
      </Show>
      <Show when={inspecting()}>
        {(node) => <PropertiesPanel node={node()} onClose={() => setInspecting(null)} />}
      </Show>
      <Show when={previewing()}>
        {(node) => (
          <PreviewDialog
            node={node()}
            siblings={items()}
            onClose={() => setPreviewing(null)}
            onNavigate={(target) => setPreviewing(target as FileNode)}
          />
        )}
      </Show>

      <UploadDrawer />
      <DropZone onDrop={uploadCandidates} />
    </Protected>
  );
}
