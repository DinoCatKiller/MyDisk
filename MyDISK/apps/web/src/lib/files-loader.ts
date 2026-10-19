import type { FileRouterNode } from "@MyDISK/api/routers/file";

import { fetchFileList, fetchFilePath } from "~/server/fns";

/** `/files` 与 `/files/$` 两个路由共用的 loader 数据形状 */
export type FilesLoaderData = {
  /** 当前目录节点 ID（裸 `/files` 为 null） */
  parentId: string | null;
  items: FileRouterNode[];
  /** 面包屑祖先链 */
  path: FileRouterNode[];
  /** 服务端取数错误（有值时前端展示告警而不是抛错页） */
  error: string;
};

/** 路由 splat 段即节点 ID 链，取最后一段作为当前目录 */
export function lastSegment(splat: string | undefined): string | null {
  const parts = (splat ?? "").split("/").filter(Boolean);
  return parts.length > 0 ? (parts[parts.length - 1] ?? null) : null;
}

/**
 * 目录首屏取数（`D8` SSR 数据装载）。
 *
 * 经 `createServerFn` 调用 oRPC：SSR 时在进程内直调，客户端导航时走 serverFn HTTP。
 */
export async function loadFiles(parentId: string | null): Promise<FilesLoaderData> {
  try {
    const [list, chain] = await Promise.all([
      fetchFileList({
        data: {
          parentId,
          keyword: null,
          sort: { field: "name", order: "asc" },
          page: 1,
          pageSize: 200,
        },
      }),
      parentId
        ? fetchFilePath({ data: { nodeId: parentId } }).catch((): FileRouterNode[] => [])
        : null,
    ]);

    return { parentId, items: list.items, path: chain ?? [], error: "" };
  } catch (loadError) {
    return {
      parentId,
      items: [],
      path: [],
      error: loadError instanceof Error ? loadError.message : "读取目录失败",
    };
  }
}
