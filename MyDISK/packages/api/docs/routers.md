# A3 · oRPC 接口契约

|        |                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------- |
| ID     | `A3`                                                                                                |
| 类型   | 规格（契约）                                                                                        |
| 状态   | 稳定（P1 落地 §2/§3；P2 落地 §4/§5/§6/§7/§10 的**子集**，各节「P2 实现状态」为准；其余为 P3+ 契约） |
| 更新   | 2026-10-15                                                                                          |
| 何时读 | 加 / 改接口、对齐前端调用、调整权限中间件时                                                         |
| 规模   | ~4k token                                                                                           |

## TL;DR

- 所有 oRPC 过程带 `.route()`，同一份实现同时具备 **RPC（`/api/rpc`）与 REST（OpenAPI 3.1）** 两种语义（`D5`）。
- 权限四档：`publicProcedure` / `protectedProcedure`（任意管理员）/ `founderProcedure`（仅创始人）/ `shareProcedure`（凭 `shareToken` + 密码）。
- 统一错误码枚举（§1.2）、统一分页返回 `{ items, total, page, pageSize }`（§1.3）。
- **二进制面不走 oRPC**（`D3`）：分片上传 / 取流见 §7，其 OpenAPI 覆盖靠 `apps/web/src/server/openapi.ts` 手写 spec 合并（§11.4）。
- 本文件是接口清单**唯一事实源**；实现的 router 见 `packages/api/src/routers/`。

---

## 1. 通用约定

### 1.1 中间件与权限

| 名称                 | 说明                                                          |
| -------------------- | ------------------------------------------------------------- |
| `publicProcedure`    | 无需登录                                                      |
| `protectedProcedure` | 需有效 session（任意管理员）                                  |
| `founderProcedure`   | 仅 `role = founder`                                           |
| `shareProcedure`     | 无登录，凭 `shareToken`(+`password`) 访问，权限由分享记录决定 |

### 1.2 统一错误码

```ts
enum ErrorCode {
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN", // 非创始人操作创始人
  NOT_FOUND = "NOT_FOUND",
  ALREADY_EXISTS = "ALREADY_EXISTS",
  INVALID_PASSWORD = "INVALID_PASSWORD",
  SHARE_PASSWORD_REQUIRED = "SHARE_PASSWORD_REQUIRED",
  STORAGE_UNREACHABLE = "STORAGE_UNREACHABLE",
  STORAGE_LOCAL_DUPLICATE = "STORAGE_LOCAL_DUPLICATE",
  UPLOAD_SESSION_EXPIRED = "UPLOAD_SESSION_EXPIRED",
  SMTP_NOT_CONFIGURED = "SMTP_NOT_CONFIGURED",
  RATE_LIMITED = "RATE_LIMITED",
}
```

### 1.3 分页与排序

```ts
const pagination = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(500).default(50),
});
const sort = z.object({
  field: z.enum(["name", "size", "createdAt", "updatedAt", "type"]),
  order: z.enum(["asc", "desc"]),
});
```

所有列表返回 `{ items, total, page, pageSize }`。

### 1.4 命名

过程名使用 `router.procedure`，前端通过 `orpc.<router>.<procedure>.queryOptions()` / `.mutationOptions()` 调用；所有变更类过程用 `mutation`。

---

## 2. `systemRouter`（系统）

| 过程             | 权限      | 输入                                            | 输出                                                               | 说明                     |
| ---------------- | --------- | ----------------------------------------------- | ------------------------------------------------------------------ | ------------------------ |
| `health`         | public    | —                                               | `"OK"`                                                             | 健康检查                 |
| `installStatus`  | public    | —                                               | `{ installed: boolean; version?: string }`                         | 未安装时前端引导到安装页 |
| `getSettings`    | protected | —                                               | `SystemSettings`                                                   | 脱敏后的系统设置         |
| `updateSettings` | founder   | `Partial<SystemSettings>`                       | `SystemSettings`                                                   |                          |
| `stats`          | protected | —                                               | `{ fileCount, totalSize, connectionCount, shareCount, trashSize }` | 首页概览                 |
| `auditLog.list`  | founder   | `pagination & { action?, userId?, from?, to? }` | `Page<AuditLog>`                                                   |                          |

---

## 3. `authRouter`（认证与管理员）

> Better-Auth 的 `/api/auth/*` **不对外暴露**，全部封装为 oRPC 过程；服务端调用 `auth.api.*`，并把返回的 `Set-Cookie` 通过 Hono context 回写。

| 过程                       | 权限      | 输入                                             | 输出                          | 说明                                              |
| -------------------------- | --------- | ------------------------------------------------ | ----------------------------- | ------------------------------------------------- |
| `getSession`               | public    | —                                                | `{ user, expiresAt } \| null` |                                                   |
| `signIn`                   | public    | `{ email, password, rememberMe? }`               | `{ user }`                    | 失败计数限流；返回后写 session cookie             |
| `signOut`                  | protected | —                                                | `{ ok: true }`                | 清 cookie                                         |
| `changePassword`           | protected | `{ currentPassword, newPassword }`               | `{ ok: true }`                | 改密后其他会话失效                                |
| `updateProfile`            | protected | `{ name?, image? }`                              | `User`                        |                                                   |
| `requestPasswordReset`     | public    | `{ email }`                                      | `{ ok: true }`                | 始终返回成功（防枚举），入队发信                  |
| `resetPassword`            | public    | `{ token, newPassword }`                         | `{ ok: true }`                |                                                   |
| `requestEmailVerification` | protected | —                                                | `{ ok: true }`                | 绑定/更换邮箱第一步                               |
| `bindEmail`                | protected | `{ email, code }`                                | `User`                        | 验证码校验后更新 email                            |
| `listAdmins`               | founder   | —                                                | `User[]`                      | 标注 founder                                      |
| `createAdmin`              | founder   | `{ email, name, password, mustChangePassword? }` | `User`                        | 服务端 `auth.api.signUpEmail` 建号并置 role=admin |
| `deleteAdmin`              | founder   | `{ userId }`                                     | `{ ok: true }`                | **禁止删除 founder**                              |
| `setAdminStatus`           | founder   | `{ userId, status }`                             | `User`                        | 启用/禁用；**禁止禁用 founder**                   |
| `listSessions`             | protected | —                                                | `Session[]`                   | 当前账号会话                                      |
| `revokeSession`            | protected | `{ sessionId }`                                  | `{ ok: true }`                |                                                   |

---

## 4. `connectionRouter`（存储连接）

| 过程                                      | 权限      | 输入                                                               | 输出                          | 说明                                                  |
| ----------------------------------------- | --------- | ------------------------------------------------------------------ | ----------------------------- | ----------------------------------------------------- |
| `list`                                    | protected | —                                                                  | `StorageConnection[]`（脱敏） |                                                       |
| `get`                                     | protected | `{ id }`                                                           | `StorageConnection`           |                                                       |
| `create`                                  | founder   | `{ name, type, bucket?, region?, endpoint?, rootPrefix?, config }` | `StorageConnection`           | `type=local` 时若已存在则报 `STORAGE_LOCAL_DUPLICATE` |
| `update`                                  | founder   | `{ id, ...patch }`                                                 | `StorageConnection`           |                                                       |
| `delete`                                  | founder   | `{ id }`                                                           | `{ ok }`                      | 有文件时需确认，级联软删                              |
| `test`                                    | founder   | `{ id }` 或 `{ draft }`                                            | `{ ok, latencyMs, error? }`   | 连通性测试                                            |
| `setDefault`                              | founder   | `{ id, sync?: "now" \| "later" \| "skip" }`                        | `{ switched: true, taskId? }` | `sync=now` 直接建同步任务                             |
| `sync`                                    | founder   | `{ fromId, toId, mode?, conflict? }`                               | `{ taskId }`                  | 手动同步                                              |
| `syncStatus`                              | protected | `{ taskId }`                                                       | `SyncJob`                     |                                                       |
| `syncPause` / `syncResume` / `syncCancel` | founder   | `{ taskId }`                                                       | `{ ok }`                      |                                                       |
| `usage`                                   | protected | `{ id }`                                                           | `{ totalSize, fileCount }`    |                                                       |

> **P2 实现状态**（`packages/api/src/routers/connection.ts`）：仅落地 `list` / `get`，输出经 `publicConnectionSchema`（`schemas/connection.ts`）**显式白名单**脱敏——字段逐个列举，`config_enc` 密文不在其列，绝不携带密钥原文。其余 CRUD / `test` / `setDefault` / `sync*` / `usage` 属 P3。

---

## 5. `fileRouter`（文件与文件夹）

| 过程                                  | 权限      | 输入                                                                                                    | 输出                         | 说明                                       |
| ------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------ |
| `list`                                | protected | `{ connectionId?, parentId?, keyword?, type?, ext?, from?, to?, minSize?, maxSize?, sort, pagination }` | `Page<FileNode>`             | 默认取当前默认连接                         |
| `tree`                                | protected | `{ connectionId?, parentId? }`                                                                          | `FileNode[]`（子节点，惰性） | 左侧目录树懒加载                           |
| `path`                                | protected | `{ nodeId }`                                                                                            | `FileNode[]`                 | 面包屑祖先链                               |
| `get`                                 | protected | `{ nodeId }`                                                                                            | `FileNode`                   |                                            |
| `mkdir`                               | protected | `{ parentId?, name }`                                                                                   | `FileNode`                   |                                            |
| `rename`                              | protected | `{ nodeId, name }`                                                                                      | `FileNode`                   | 只改展示名，不动物理键                     |
| `move`                                | protected | `{ nodeIds[], targetParentId?, targetConnectionId? }`                                                   | `{ moved: number, taskId? }` | 跨连接走队列任务                           |
| `copy`                                | protected | `{ nodeIds[], targetParentId?, targetConnectionId? }`                                                   | `{ taskId }`                 |                                            |
| `remove`                              | protected | `{ nodeIds[] }`                                                                                         | `{ removed: number }`        | 软删进回收站（递归）                       |
| `listTrash`                           | protected | `pagination`                                                                                            | `Page<FileNode>`             |                                            |
| `restore`                             | protected | `{ nodeIds[] }`                                                                                         | `{ restored: number }`       |                                            |
| `purge`                               | protected | `{ nodeIds[] }`                                                                                         | `{ taskId }`                 | 彻底删除（队列物理删）                     |
| `emptyTrash`                          | protected | —                                                                                                       | `{ taskId }`                 |                                            |
| `stats`                               | protected | `{ nodeId }`                                                                                            | `FileNodeStats`              | 属性面板：大小/校验和/物理键/时间/分享状态 |
| `favorite` / `unfavorite`             | protected | `{ nodeId }`                                                                                            | `FileNode`                   | 收藏开关（P2 收尾已落，写 `is_favorite`）  |
| `listFavorites`                       | protected | `pagination`                                                                                            | `Page<FileNode>`             | 收藏列表（P2 收尾已落，按修改时间倒序）    |
| `search`                              | protected | `{ keyword, filters }`                                                                                  | `Page<FileNode>`             | 名称/类型/时间/大小/标签过滤               |
| `tag.add` / `tag.remove` / `tag.list` | protected | `{ nodeId, tagId }`                                                                                     | —                            |                                            |
| `batchDownload`                       | protected | `{ nodeIds[] }`                                                                                         | `{ taskId }`                 | 打包为 zip（队列）                         |

> **P2 实现状态**（`packages/api/src/routers/file.ts`）：已落地 `list` / `tree` / `path` / `get` / `mkdir` / `rename` / `move` / `remove` / `listTrash` / `restore` / `purge` / `emptyTrash` / `stats` / `favorite` / `unfavorite` / `listFavorites`。
>
> - 未落地：`copy` / `search` / `tag.*` / `batchDownload`（属 P3+；`list` 已支持 `keyword` 名称模糊过滤）。
> - `move` / `copy` 本期**仅同连接**：跨连接抛 `NOT_IMPLEMENTED`；`move` 会校验目标为同连接目录且禁止移入自身子孙。
> - `purge` / `emptyTrash` 直接物理删除（不经队列）；秒传产生的共享 `storage_key` 仅在最后一个引用被清除时才删存储对象。

---

## 6. `uploadRouter`（上传控制面）

> 分片二进制体走 `/api/upload/chunk`（见 §7），此 router 只管会话与状态。

| 过程               | 权限      | 输入                                                                                                       | 输出                                                                                                      | 说明                                                     |
| ------------------ | --------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `init`             | protected | `{ connectionId?, parentId?, fingerprint, originalName, mime?, size, chunkSize?, sha256?, relativePath? }` | `{ uploadId, chunkSize, totalChunks, uploadedParts[], providerUploadId?, storageKey, instant?: boolean }` | 同 fingerprint 复用会话 → 断点续传；`sha256` 命中 → 秒传 |
| `simple`           | protected | `{ parentId?, file: File }`                                                                                | `FileNode`                                                                                                | 小文件（<8MB）单次上传                                   |
| `chunkMeta`        | protected | `{ uploadId, index }`                                                                                      | `{ received: boolean, etag? }`                                                                            | 单分片校验（可选）                                       |
| `complete`         | protected | `{ uploadId, parts? }`                                                                                     | `{ fileNode }`                                                                                            | 合并；文件夹上传时按 `relativePath` 自动建目录树         |
| `abort`            | protected | `{ uploadId }`                                                                                             | `{ ok }`                                                                                                  | 停止：清理临时分片与会话                                 |
| `pause` / `resume` | protected | `{ uploadId }`                                                                                             | `{ ok }`                                                                                                  | 服务端标记（前端本地状态为主）                           |
| `listPending`      | protected | —                                                                                                          | `UploadSession[]`                                                                                         | **刷新恢复队列**                                         |
| `cleanupExpired`   | protected | —                                                                                                          | `{ cleaned: number }`                                                                                     | 手动触发 GC                                              |

> **P2 实现状态**（`packages/api/src/routers/upload.ts`）：已落地 `init` / `complete` / `abort` / `pause` / `resume` / `chunkMeta` / `listPending` / `cleanupExpired`。
>
> - `init` 返回**判别联合**：秒传命中 → `{ instant: true, fileNode }`；否则 → `{ instant: false, uploadId, chunkSize, totalChunks, uploadedParts, providerUploadId, storageKey }`。
> - `complete` 输入仅 `{ uploadId }`：以驱动 `listParts` 为权威真相（DB `uploadedParts` 仅作前端续传提示），合并后写入 `file_node`。
> - **`simple` 未单独实现**：小文件走同一分片路径（`ceil(size/chunkSize)` 为 1 即单分片），故本期不需要独立的小文件接口。
> - `chunkMeta` 仅查 DB 已记录分片号；`init` 幂等（同 fingerprint 复用会话），因此「继续 = 重新 `init` 对账」。
> - 文件夹上传：`init` 按 `relativePath` 逐级 `ensureFolderPath` 补齐中间目录，落点为末级目录。

---

## 7. 原生 HTTP 路由（非 oRPC，二进制面）

| 路由                              | 方法        | 鉴权                                | 说明                                                                      |
| --------------------------------- | ----------- | ----------------------------------- | ------------------------------------------------------------------------- |
| `/api/upload/chunk`               | POST        | session cookie 或短时签名           | `?uploadId&index`，body 为原始分片流；支持并发，返回 `{ received, etag }` |
| `/api/raw/:nodeId`                | GET/HEAD    | 签名 token（`?token=`）             | 支持 `Range` → 206；`dl=1` 触发下载文件名；预览用 `inline=1`              |
| `/api/raw/share/:shareId/:nodeId` | GET         | 分享签名                            | 分享场景取流                                                              |
| `/api/reference`                  | GET         | —                                   | oRPC 交互式文档（Scalar 主题）                                            |
| `/dav/*`                          | WebDAV 方法 | Basic Auth（管理员或 webdav_token） | 见 `A6` §8                                                                |

> 签名 token（`packages/api/src/lib/raw-token.ts`）：`HMAC-SHA256` 签名的 `base64url(payload).base64url(sig)`，TTL 900 秒，
> payload 含 `{ nodeId, userId, exp }`（结构由 `schemas/raw.ts` 的 `rawTokenPayloadSchema` 校验）；服务端每次校验签名、过期与 `nodeId` 归属（防止令牌被挪用）。
> 前端经 `preview.url` 取签名地址；跨域 `<img>/<video>` 无法带 Cookie，故必须用签名 URL 而非会话 Cookie。
>
> **P2 实现状态**：`/api/upload/chunk`（`apps/web/src/server/routes/upload-chunk.ts`，session Cookie 鉴权 + 驱动 `multipart.uploadPart`）
> 与 `/api/raw/:nodeId`（`apps/web/src/server/routes/raw.ts`，签名 token 或 Cookie 双鉴权，Range → 206/416）已落地；
> `/api/raw/share/*` 与 `/dav/*` 属 P3/P4。
>
> 二进制面的参数（path / query / `Range` 头）同样由 Zod 校验，schema 与 oRPC 侧在**同一处**（`packages/api/src/schemas/`）：
> `raw.ts` 提供 `rawNodeIdSchema` / `rawQuerySchema` / `rawTokenPayloadSchema` / `byteRangeHeaderSchema(size)`，
> `upload.ts` 提供 `uploadChunkQuery`；`apps/web/src/server` 直接 import 复用，不再手写 `Number()` 解析。
> `nodeId` / `uploadId` 校验为 uuid，可挡住会打到 PG 的非法 id（否则 PG 报 `invalid input syntax for uuid` → 500）。

---

## 8. `shareRouter`（分享）

| 过程        | 权限      | 输入                                                                                    | 输出                   | 说明               |
| ----------- | --------- | --------------------------------------------------------------------------------------- | ---------------------- | ------------------ |
| `create`    | protected | `{ nodeId, password?, expiresAt?, maxDownloads?, canPreview?, canDownload?, canList? }` | `{ token, url }`       | 文件/文件夹均可    |
| `list`      | protected | `{ nodeId? } & pagination`                                                              | `Page<ShareLink>`      |                    |
| `update`    | protected | `{ id, ...patch }`                                                                      | `ShareLink`            | 仅创建者或 founder |
| `revoke`    | protected | `{ id }`                                                                                | `{ ok }`               |                    |
| `accessLog` | protected | `{ id } & pagination`                                                                   | `Page<ShareAccessLog>` |                    |

### 公开过程（无登录，`shareProcedure`）

| 过程                 | 输入                                    | 输出                                                                                        | 说明                                     |
| -------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `public.info`        | `{ token }`                             | `{ node: { name, type, size }, needPassword, canPreview, canDownload, canList, expiresAt }` |                                          |
| `public.unlock`      | `{ token, password }`                   | `{ shareToken: string }`                                                                    | 密码正确返回短时访问令牌（后续请求携带） |
| `public.list`        | `{ token, shareToken?, parentNodeId? }` | `Page<FileNode>`                                                                            | 文件夹分享列目录                         |
| `public.downloadUrl` | `{ token, shareToken?, nodeId? }`       | `{ url }`                                                                                   | 签名下载链接                             |
| `public.package`     | `{ token, shareToken?, nodeIds[] }`     | `{ taskId }`                                                                                | 整目录打包下载（队列）                   |

---

## 9. `taskRouter`（异步任务）

| 过程     | 权限      | 输入                              | 输出         | 说明                               |
| -------- | --------- | --------------------------------- | ------------ | ---------------------------------- |
| `list`   | protected | `{ status?, type? } & pagination` | `Page<Task>` |                                    |
| `get`    | protected | `{ id }`                          | `Task`       | 含 `progress` / `result` / `error` |
| `cancel` | protected | `{ id }`                          | `{ ok }`     |                                    |
| `retry`  | protected | `{ id }`                          | `{ ok }`     |                                    |
| `clear`  | protected | `{ ids[] }`                       | `{ ok }`     | 清理已完成记录                     |

> 压缩 (`archive.compress`)、解压 (`archive.extract`) 也通过 `fileRouter` 建任务，统一在 `taskRouter` 查询：

| 过程（挂 `archiveRouter`） | 输入                                   | 说明                                           |
| -------------------------- | -------------------------------------- | ---------------------------------------------- |
| `compress`                 | `{ nodeIds[], targetParentId?, name }` | 生成 zip，客户端小文件优先、大文件走服务端任务 |
| `extract`                  | `{ nodeId, targetParentId? }`          | 解压到目录                                     |

---

## 10. `previewRouter`（预览）

| 过程     | 权限      | 输入                          | 输出                                                | 说明                                 |
| -------- | --------- | ----------------------------- | --------------------------------------------------- | ------------------------------------ |
| `url`    | protected | `{ nodeId, inline? }`         | `{ url, ttl }`                                      | 签名直链（云存储）或 `/api/raw` 代理 |
| `info`   | protected | `{ nodeId }`                  | `{ width?, height?, duration?, pages?, thumbKey? }` | 读取 `file_node.meta`                |
| `text`   | protected | `{ nodeId, offset?, limit? }` | `{ content, truncated }`                            | 文本/代码/Markdown 取内容            |
| `office` | protected | `{ nodeId }`                  | `{ html }`                                          | docx/xlsx 服务端转 HTML，结果缓存    |

缩略图：上传完成后入队 `thumbnail` 任务，写入 `meta.thumbKey`，列表读取签名 URL。

> **P2 实现状态**（`packages/api/src/routers/preview.ts`）：仅落地 `url`（输入 `{ nodeId, inline?, download? }` → `{ url, ttl: 900 }`）。
> `info` / `text` / `office` 与缩略图队列属 P3。

---

## 11. OpenAPI 文档化

> 需求中的「openai」为 **OpenAPI** 之误：本系统**不提供任何 AI 接口**，全部接口以 OpenAPI 3.1 输出。

### 11.1 双协议（RPC + REST）

每个过程在定义时附加 `.route()`，同一份实现同时服务两种调用方式：

```ts
export const list = protectedProcedure
  .route({ method: "GET", path: "/files", summary: "列出目录内容", tags: ["file"] })
  .input(listInput)
  .handler(/* ... */);
```

- 前端：`/api/rpc`（类型安全，主用）
- 外部系统/文档：REST 路径 + `/api/reference`

### 11.2 端点

| 端点                | 方法 | 鉴权            | 说明                                              |
| ------------------- | ---- | --------------- | ------------------------------------------------- |
| `/api/rpc`          | POST | cookie / bearer | oRPC RPC 入口                                     |
| `/api/reference`    | GET  | 无（生产可关）  | `OpenAPIReferencePlugin`（Scalar 主题）交互式文档 |
| `/api/openapi.json` | GET  | 无（生产可关）  | `OpenAPIGenerator` 产出，Redis 缓存 5 分钟        |

### 11.3 标签与路径规范

| tag          | 路径前缀                    | 示例                                                                   |
| ------------ | --------------------------- | ---------------------------------------------------------------------- |
| `system`     | `/system`                   | `GET /system/settings`                                                 |
| `auth`       | `/auth`                     | `POST /auth/sign-in`、`POST /auth/admins`                              |
| `connection` | `/connections`              | `POST /connections/{id}/default`                                       |
| `file`       | `/files`                    | `POST /files/move`、`POST /files/remove`、`POST /files/batch-download` |
| `upload`     | `/uploads`                  | `POST /uploads/init`、`POST /uploads/{id}/complete`                    |
| `share`      | `/shares`、`/public/shares` | 管理端与公开访问分离                                                   |
| `task`       | `/tasks`                    | `GET /tasks/{id}`                                                      |
| `preview`    | `/preview`                  | `GET /preview/{nodeId}/url`                                            |
| `smtp`       | `/smtp`                     | `POST /smtp/test`                                                      |
| `webdav`     | `/webdav`                   | `POST /webdav/tokens`                                                  |

### 11.4 二进制接口（手写 spec 补充）

`/api/upload/chunk`、`/api/raw/{nodeId}`、`/dav/*` 不经过 oRPC，无法自动推导 schema。在 `apps/web/src/server/openapi.ts` 中维护手写片段并与自动生成结果合并：

```ts
const rawPaths = {
  "/api/raw/{nodeId}": {
    get: {
      tags: ["raw"],
      summary: "流式下载/预览",
      parameters: [/* nodeId path, token query, dl/inline query */],
      responses: { 200: { description: "文件流" }, 206: { description: "分片响应（Range）" } },
      security: [{ queryToken: [] }],
    },
  },
  // /api/upload/chunk: requestBody application/octet-stream
};
```

三个 security scheme：`cookieAuth`（管理员会话）、`bearerAuth`（WebDAV / 分享令牌）、`queryToken`（签名 URL）。公开操作标注 `security: []`。

### 11.5 约定与校验

- 所有 `input`/`output` 必须 Zod 定义（否则无法转 JSON Schema）；**所有 schema 集中在 `packages/api/src/schemas/`**（按 router 分文件，`common.ts` 放分页 / 排序 / `queryIntSchema` / `ok`），router 只声明 `.input()` / `.output()`；
  - 非 oRPC 的**二进制面参数 schema 也放这里**（`raw.ts` / `upload.ts`），由 `apps/web/src/server` 复用，避免同一参数两套解析；
- 每个操作必填 `summary` + `tags`；
- 错误统一 `components.schemas.ErrorResponse`（含 `code` 字段，取值见 §1.2）；
- CI 校验：spec 中的 path 数 = oRPC 过程数 + 手写补充路径数，防止接口漏文档。

---

## 12. `smtpRouter`（邮件）

| 过程     | 权限    | 输入               | 输出                      | 说明             |
| -------- | ------- | ------------------ | ------------------------- | ---------------- |
| `get`    | founder | —                  | `SmtpSetting`（密码脱敏） |                  |
| `update` | founder | `SmtpSettingInput` | `SmtpSetting`             | 密码加密存储     |
| `test`   | founder | `{ to }`           | `{ ok, messageId? }`      | 入队发送测试邮件 |
| `remove` | founder | —                  | `{ ok }`                  |                  |

---

## 13. `webdavRouter`

| 过程            | 权限      | 输入                   | 输出                        | 说明                 |
| --------------- | --------- | ---------------------- | --------------------------- | -------------------- |
| `getConfig`     | protected | —                      | `{ enabled, url }`          |                      |
| `setEnabled`    | founder   | `{ enabled }`          | `{ ok }`                    |                      |
| `tokens.list`   | protected | —                      | `WebdavToken[]`（不含明文） |                      |
| `tokens.create` | protected | `{ name, expiresAt? }` | `{ token }`                 | **明文仅此一次返回** |
| `tokens.revoke` | protected | `{ id }`               | `{ ok }`                    |                      |

---

## 14. 权限矩阵速查

| 能力                       | 未登录          | admin | founder |
| -------------------------- | --------------- | ----- | ------- |
| 登录/找回密码              | ✓               | —     | —       |
| 浏览/上传/下载/分享文件    | —               | ✓     | ✓       |
| 压缩/解压/预览             | —               | ✓     | ✓       |
| 新建/编辑/删除存储连接     | —               | —     | ✓       |
| 切换默认连接、发起同步     | —               | —     | ✓       |
| 管理员增删改               | —               | —     | ✓       |
| SMTP / 系统设置 / 审计日志 | —               | —     | ✓       |
| 分享页访问                 | ✓（token/密码） | —     | —       |
| WebDAV                     | Basic Auth      | ✓     | ✓       |

---

## 15. 前端调用示例

```ts
// 查询
const files = useQuery(() =>
  orpc.file.list.queryOptions({
    input: { parentId: currentFolderId(), pagination: { page: 1, pageSize: 100 } },
  }),
);

// 变更
const mkdir = useMutation(() => orpc.file.mkdir.mutationOptions());
mkdir.mutate({ parentId: null, name: "新建文件夹" });

// 上传（控制面）
const init = await client.upload.init({
  fingerprint,
  originalName: f.name,
  size: f.size,
  mime: f.type,
});
// 数据面：XHR PUT /api/upload/chunk?uploadId=...&index=i
// 完成：await client.upload.complete({ uploadId });
```

> 由于 `@orpc/tanstack-query` 在 Solid 下为 RC 版本，`queryOptions()` 的 `input` 需传函数式 getter 以保持响应式（详见编码阶段的适配约定）。
