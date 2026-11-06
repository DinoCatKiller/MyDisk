# P3-6 · 压缩解压 + 打包下载 + copy/search 实施规格

|        |                                                                        |
| ------ | ---------------------------------------------------------------------- |
| ID     | 计划（P3-6）                                                           |
| 状态   | 待评审                                                                 |
| 何时读 | 实施 / 评审 P3-6 时                                                    |
| 依据   | `RM`（P3-6 完成标准）、`A6` §3/§4/§6、`A2` §9（`task` 表）、`A4`、`D3` |

## 1. 目标（可演示）

1. 管理端：选中/单个文件或目录 → 服务端队列压缩为 zip，落到目标目录；zip/tar.gz 文件 → 解压到目标目录（重名 `keep_both`）。
2. 管理端：目录「打包下载」→ 队列产出临时 zip → 签名地址直接下载（不生成新 file_node）。
3. 分享页：整目录「打包下载」→ 同一个 `task` 机制，公开轮询拿到签名地址。
4. 所有长任务写 `task` 表，前端轮询展示进度、可取消。
5. API 补齐 `file.copy`（同连接递归复制）与 `file.search`（全局名称搜索）。

## 2. 队列与上下文

- `packages/api/package.json` 增加 `@MyDISK/queue: workspace:*`（依赖方向 `packages/api → packages/queue` 合法）。
- `packages/api/src/context.ts`：`Context` 增加 `redisUrl: string`。
- `apps/web/src/server/context.ts`：注入 `redisUrl: serverConfig.redisUrl`。
- 新增 `packages/api/src/lib/archive-queue.ts`：
  - `archiveQueue(redisUrl): Queue`：按 URL 缓存单例（`createQueue(QUEUE_NAMES.archive, url)`）。
  - `enqueueArchiveJob(redisUrl, data: ArchiveJobData)`：`queue.add("archive", data, { jobId: data.taskId })`。
  - `cancelArchiveJob(redisUrl, taskId)`：`queue.getJob(taskId)?.remove()`，失败忽略。

## 3. API 新增

### 3.1 `schemas/task.ts`

- `taskViewSchema`：`id/type/status/progress/title/payload/result/error/startedAt/finishedAt/createdAt/updatedAt`（payload/result 用 `z.record(z.string(), z.unknown()).nullable()`）。
- `taskListInput = paginationSchema.extend({ type: taskTypeEnum optional, status: taskStatusEnum optional })`。
- `taskListSchema = pageSchema(taskViewSchema)`、`taskIdInput = { id: uuid }`。
- `archiveCompressInput = { nodeIds: uuid[] min1, targetParentId?: uuid|null, name?: string max255 }`。
- `archiveExtractInput = { nodeId: uuid, targetParentId?: uuid|null }`。
- `archivePackageInput = { nodeIds: uuid[] min1 }`，输出 `{ task: taskViewSchema }`（含 `downloadUrl?: string|null`）。

### 3.2 `routers/archive.ts`（新增，挂到 `appRouter.archive` 与 `appRouter.task`）

- `task.list`（GET `/tasks`，protected，按 `userId = session.user.id` 过滤）。
- `task.get`（GET `/tasks/{id}`，protected，同上 + founder 放行），package_download 且 completed 时计算 `downloadUrl`。
- `task.cancel`（POST `/tasks/{id}/cancel`，protected）：仅 `pending/running` 可取消 → 写 `status=cancelled`，再 `cancelArchiveJob`。
- `archive.compress`（POST `/archives/compress`，protected）：
  - 节点必须存在、未删、同连接；`targetParentId` 必须是同连接文件夹（缺省 = 首个节点父目录）。
  - 默认名：单节点 `<node.name>.zip`，多节点 `archive-<yyyyMMdd-HHmm>.zip`。
  - 建 `task`（type `compress`，title `压缩 <name>`，payload `{nodeIds,targetParentId,name}`），入队，返回 task。
- `archive.extract`（POST `/archives/extract`，protected）：
  - 目标节点必须是文件且扩展名 ∈ `zip|tar|gz|tgz`。
  - 建 `task`（type `extract`），入队。
- `archive.package`（POST `/archives/package`，protected）：type `package_download`，不建 file_node。

### 3.3 `file.copy` / `file.search`

- `file.copy`（POST `/files/copy`）：`{ nodeIds, targetParentId? }` → `{ copied: number }`。
  - 同连接；目标不能是自身/子孙；递归复制目录结构与文件。
  - 文件用 `driver.copy(srcKey, buildStorageKey(connectionId, name))` 生成**新物理键**（对象存储 copy 语义），写入新 `file_node`（size/mime/ext/checksum 继承）。
- `file.search`（GET `/files/search`）：`{ keyword min1, type?, connectionId?, page, pageSize }` → `fileNodeListSchema`；`name ILIKE`、排除已删、按 `updatedAt desc`。

### 3.4 分享打包（`routers/share.ts` + `schemas/share.ts`）

- `public.package`（POST `/public/shares/{token}/package`）：`{ token, shareToken?, nodeIds[] }`
  - 校验分享可用 + `requireShareAccess` + `share.canDownload` 必须为 true；每个 node 必须在分享子树内。
  - 建 `task`（userId = `share.createdBy`，type `package_download`），入队，返回 `{ taskId }`。
- `public.task`（GET `/public/shares/{token}/tasks/{taskId}`）：`{ token, shareToken? }` 查询路径参数
  - 校验分享；task 必须存在、type `package_download`、`userId === share.createdBy`。
  - 返回 `{ id, status, progress, error, downloadUrl }`；completed 时签名地址。

### 3.5 二进制面（`D3`）

- `schemas/raw.ts`：新增 `taskRawTokenPayloadSchema = { taskId: uuid, exp: number }`。
- `lib/raw-token.ts`：`signTaskRawToken` / `verifyTaskRawToken` / `buildTaskRawUrl`（`/api/raw/task/{taskId}?token=&dl=1`）。
- 新增 `apps/web/src/server/routes/task-raw.ts`：`GET/HEAD /api/raw/task/:taskId?token=&dl=1`
  - 校验令牌 → task 必须 `completed` 且 `type=package_download`，`result` 含 `{ storageKey, connectionId, name }`。
  - 复用 `byteRangeHeaderSchema` 支持 Range/206，`Content-Disposition: attachment`。
- `apps/web/src/server/app.ts` 注册 `taskRawRoute`。

## 4. Worker

### 4.1 依赖寄存器

- `apps/worker/src/index.ts`：`archive: async (job) => runArchive(env, job.data as ArchiveJobData)`；并发沿用 `A1` §4（archive = 2）。
- `apps/worker/src/processors/archive.ts`：
  - 读 task → `status=running, startedAt=now`；每个阶段 `updateTaskProgress`；发现库内 `status=cancelled` 即中止（写 cancelled，不重试）。
  - **compress**：`collectTree`（BFS 收集子树 + 相对路径）→ `createZipStream` → `driver.put(buildStorageKey(...))` → 插入 file_node（`application/zip`、ext `zip`）→ `result={fileNodeId}` → `status=completed, progress=100`。
  - **package_download**：同一 zip 流 → `driver.put('_tasks/<taskId>/<name>.zip')` → `result={connectionId,storageKey,name,size}`。
  - **extract**：`driver.get` 下载到 `<storageRoot>/.tmp/tasks/<taskId>/<name>` → 按扩展名选 zip / tar.gz 读取器 → 逐 entry 写存储 + 建节点（目录 `ensureFolderPath`，文件 `buildStorageKey` + `resolveUniqueName`）→ 清理临时目录。
  - 失败：`status=failed, error=message, finishedAt=now` 后抛出（让 BullMQ 重试；重试时先重置 running）。
- 新增 worker 自持工具（依赖方向不允许 import `@MyDISK/api`）：
  - `src/lib/archive-tree.ts`：`collectTree`、`resolveUniqueName`、`ensureFolderPath`、`safeEntryName`（拒绝 `..`/绝对路径）。
  - `src/lib/zip-writer.ts`：流式 zip writer（deflateRaw + data descriptor + central directory；UTF-8 flag；>4GB 或 >65535 entry 抛明确错误）。
  - `src/lib/zip-reader.ts`：解析 EOCD/中央目录，逐 entry Range 读取压缩数据并 inflate（zip64 明确报错）。
  - `src/lib/tar-reader.ts`：`createGunzip` + 512 字节块解析（ustar、GNU longname `L`、`5` 目录、`0` 文件）。

## 5. 前端

- `file-row.tsx`：新增 `onCompress(node)`（全部节点）与 `onExtract(node)`（扩展名 zip/tar/gz/tgz）；文件夹的下载按钮改为走打包。
- `files-browser.tsx`：
  - `compress(node)` → `client.archive.compress`；`extract(node)` → `client.archive.extract`。
  - `download(node)`：文件仍走 `preview.url`；文件夹走 `client.archive.package`，完成后跳转 `downloadUrl`。
  - 新增 `components/task/task-progress.tsx`（+ module.css）：轮询 `client.task.get`（1200ms）展示 title/progress/错误，可取消；完成/失败回调 `onDone(task)`。
- 分享页 `routes/share/$token.tsx`：目录/根节点在 `canDownload` 时显示「打包下载」；调 `share.public.package` → 轮询 `share.public.task` → 打开 `downloadUrl`。
- 新图标：`ArchiveIcon` / `UnarchiveIcon` 加入 `components/ui/icons.tsx`（沿用现有 SVG 风格）。

## 6. 文档同批更新

- `packages/api/docs/routers.md`：新增 `taskRouter` / `archiveRouter`；`file.copy/search`；分享 `public.package/task`；`/api/raw/task` 说明。
- `packages/queue/README.md`、`apps/worker/README.md`：archive 已消费。
- `docs/features.md` §6：状态与实现方式。
- `STATUS.md`：P3-6 ✅，下一步 P4。
- `AGENTS.md` §2：登记本规格（`docs/plans/p3-6-archive/spec.md`）。

## 7. 验证

1. `bunx tsc -b packages/api`
2. `bunx tsc -b apps/web`
3. `cd apps/worker; bunx tsc --noEmit`
4. `bun run check`（oxlint + oxfmt）
5. `bun test apps/worker/src/lib/zip.test.ts`（自写 zip → 自读回环，校验名称/内容）
6. 烟测（Redis + worker + web）：
   - 目录压缩 → 列表出现 `<name>.zip`；
   - zip 解压 → 目标目录还原；
   - 目录打包下载 → 签名地址可下载；
   - 分享页整目录打包 → 轮询完成并下载；
   - 任务列表进度从 pending → running → completed。
7. 中文 commit，汇报 hash + 变更文件列表。

## 8. 明确不做

- 客户端 `zip.js` 流式压缩（`A6` §6 首选方案）留到后续优化；本期统一服务端队列，满足「大目录」路径。
- 跨连接 copy（与 `file.move` 现有约束一致，仍然拒绝）。
- 解压 tar（非 gz）之外的 rar/7z。
- zip64（>4GB / >65535 entry）明确报错。
