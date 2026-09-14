# MyDisk 数据库模型设计

> 版本：v1.0（待评审）
> ORM：Drizzle 0.45.2 · 数据库：PostgreSQL（库名 `pstorage`）
> 连接串：`postgres://postgres:123456@127.0.0.1:5432/pstorage`

---

## 0. 约定

- 主键：业务表用 `uuid`（`defaultRandom()`），Better-Auth 原生表沿用其 `text` 主键；
- 时间：`timestamptz`，`defaultNow()`；`updated_at` 用 `$onUpdate(() => new Date())`；
- 容量/大小：`bigint`（字节），Drizzle 中 `{ mode: "number" }`；
- 枚举：优先 `pgEnum`（DB 层约束），其次 `text` + Zod 校验；
- 软删：`deleted_at timestamptz`（null 表示未删除）；
- 加密字段：命名 `*_enc`，AES-256-GCM，`ENCRYPTION_KEY` 派生；
- JSON：`jsonb`，Drizzle 中 `$type<T>()`；
- 所有业务表加 `created_at` / `updated_at`。

---

## 1. 表总览（19 张）

| #   | 表名                 | 类别 | 说明                                 |
| --- | -------------------- | ---- | ------------------------------------ |
| 1   | `user`               | auth | 管理员账户（扩展 role / founder 等） |
| 2   | `session`            | auth | 会话                                 |
| 3   | `account`            | auth | 凭据（密码 / 邮箱绑定）              |
| 4   | `verification`       | auth | 验证码、密码重置、邮箱验证           |
| 5   | `storage_connection` | 业务 | 存储连接（local/cos/oss/s3）         |
| 6   | `file_node`          | 业务 | 文件与文件夹统一树                   |
| 7   | `upload_session`     | 业务 | 分片上传会话（断点续传依据）         |
| 8   | `share_link`         | 业务 | 分享链接（含密码、文件夹）           |
| 9   | `share_access_log`   | 业务 | 分享访问审计                         |
| 10  | `sync_job`           | 业务 | 连接间同步任务                       |
| 11  | `sync_job_item`      | 业务 | 同步任务明细                         |
| 12  | `task`               | 业务 | 通用异步任务（压缩/解压/打包下载）   |
| 13  | `smtp_setting`       | 业务 | SMTP 配置（单条）                    |
| 14  | `system_setting`     | 业务 | KV 系统设置                          |
| 15  | `favorite`           | 业务 | 收藏                                 |
| 16  | `tag`                | 业务 | 标签                                 |
| 17  | `file_tag`           | 业务 | 文件-标签关联                        |
| 18  | `webdav_token`       | 业务 | WebDAV 专用令牌                      |
| 19  | `audit_log`          | 业务 | 操作审计                             |

> 已移除 `ai_asset` 表：需求中的「openai」实为 **OpenAPI**，本系统不引入 AI 能力。

---

## 2. 枚举定义

```ts
export const userRole = pgEnum("user_role", ["founder", "admin"]);
export const userStatus = pgEnum("user_status", ["active", "disabled"]);
export const storageType = pgEnum("storage_type", ["local", "cos", "oss", "s3"]);
export const connectionStat = pgEnum("connection_status", ["active", "disabled", "error"]);
export const nodeType = pgEnum("node_type", ["file", "folder"]);
export const nodeStatus = pgEnum("node_status", ["active", "uploading", "failed", "trashed"]);
export const uploadStatus = pgEnum("upload_status", [
  "pending",
  "uploading",
  "paused",
  "completed",
  "aborted",
  "failed",
]);
export const shareStatus = pgEnum("share_status", ["active", "expired", "revoked"]);
export const jobStatus = pgEnum("job_status", [
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
export const taskType = pgEnum("task_type", [
  "compress",
  "extract",
  "package_download",
  "thumbnail",
  "purge",
]);
export const taskStatus = pgEnum("task_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export const syncConflict = pgEnum("sync_conflict", ["keep_both", "overwrite", "skip"]);
```

---

## 3. 认证相关表（1–4）

### 3.1 `user`（Better-Auth 原生 + 扩展）

| 字段                        | 类型        | 约束                       | 说明                           |
| --------------------------- | ----------- | -------------------------- | ------------------------------ |
| `id`                        | text        | PK                         | Better-Auth 生成               |
| `name`                      | text        | NOT NULL                   | 显示名（默认管理员 `pincman`） |
| `email`                     | text        | NOT NULL, UNIQUE           | 登录主标识                     |
| `email_verified`            | boolean     | NOT NULL, default false    | 邮箱是否已验证                 |
| `image`                     | text        |                            | 头像 URL                       |
| `role`                      | user_role   | NOT NULL, default `admin`  | `founder` 唯一                 |
| `status`                    | user_status | NOT NULL, default `active` | 禁用后不可登录                 |
| `must_change_password`      | boolean     | NOT NULL, default false    | 首次登录强制改密               |
| `last_login_at`             | timestamptz |                            |                                |
| `last_login_ip`             | text        |                            |                                |
| `created_at` / `updated_at` | timestamptz | NOT NULL                   |                                |

**约束**：`founder` 角色全局唯一 → 用部分唯一索引

```sql
CREATE UNIQUE INDEX user_founder_uidx ON "user" ((role)) WHERE role = 'founder';
```

### 3.2 `session`

沿用 Better-Auth 原生结构：`id, expires_at, token(UNIQUE), created_at, updated_at, ip_address, user_agent, user_id(FK→user, cascade)` + 索引 `session_userId_idx`。

扩展（可选）：`impersonated_by text`（预留）。

### 3.3 `account`

原生结构：`id, account_id, provider_id, user_id(FK), access_token, refresh_token, id_token, access_token_expires_at, refresh_token_expires_at, scope, password, created_at, updated_at`，唯一索引 `(provider_id, account_id)`。

`provider_id = 'credential'` 时 `password` 存 Better-Auth 的 scrypt 哈希。

### 3.4 `verification`

原生结构：`id, identifier, value, expires_at, created_at, updated_at`，索引 `(identifier)`。

用途扩展（`value` 内存 JSON）：

- 邮箱绑定验证码
- 密码重置令牌
- 邮箱验证链接

---

## 4. 存储连接（5）

### `storage_connection`

| 字段                        | 类型              | 约束                       | 说明                                                |
| --------------------------- | ----------------- | -------------------------- | --------------------------------------------------- |
| `id`                        | uuid              | PK                         |                                                     |
| `name`                      | text              | NOT NULL, UNIQUE           | 连接显示名（WebDAV 路径也用它）                     |
| `type`                      | storage_type      | NOT NULL                   | local / cos / oss / s3                              |
| `is_default`                | boolean           | NOT NULL, default false    | 全局唯一为 true                                     |
| `status`                    | connection_status | NOT NULL, default `active` |                                                     |
| `bucket`                    | text              |                            | 云存储桶名（local 为空）                            |
| `region`                    | text              |                            | 地域                                                |
| `endpoint`                  | text              |                            | S3 兼容端点                                         |
| `root_prefix`               | text              | default `''`               | 连接内根前缀                                        |
| `config_enc`                | text              |                            | **加密**的完整配置 JSON（AK/SK、forcePathStyle 等） |
| `config_masked`             | jsonb             |                            | 脱敏配置（供前端展示，如 `AKID****abcd`）           |
| `total_size`                | bigint            | default 0                  | 统计：已用容量                                      |
| `file_count`                | integer           | default 0                  | 统计：文件数                                        |
| `sync_status`               | text              |                            | `synced` / `pending` / `skipped` / `syncing`        |
| `last_sync_at`              | timestamptz       |                            |                                                     |
| `last_error`                | text              |                            | 最近一次连通性/操作错误                             |
| `created_by`                | text              | FK→user                    |                                                     |
| `created_at` / `updated_at` | timestamptz       | NOT NULL                   |                                                     |

**约束**

```sql
-- 默认连接唯一
CREATE UNIQUE INDEX connection_default_uidx ON storage_connection ((is_default)) WHERE is_default = true;
-- 本地连接全库唯一
CREATE UNIQUE INDEX connection_local_uidx ON storage_connection ((type)) WHERE type = 'local';
```

---

## 5. 文件树（6）

### `file_node`

| 字段                        | 类型        | 约束                            | 说明                                               |
| --------------------------- | ----------- | ------------------------------- | -------------------------------------------------- |
| `id`                        | uuid        | PK                              |                                                    |
| `connection_id`             | uuid        | FK→storage_connection, NOT NULL | 所属连接                                           |
| `parent_id`                 | uuid        | FK→file_node(self), 可空        | null = 连接根                                      |
| `owner_id`                  | text        | FK→user, NOT NULL               | 创建者                                             |
| `type`                      | node_type   | NOT NULL                        | file / folder                                      |
| `name`                      | text        | NOT NULL                        | **展示名 / 原始文件名**                            |
| `storage_key`               | text        | NOT NULL                        | 物理键（unix 时间戳重命名后的路径）                |
| `mime`                      | text        |                                 | 文件 MIME（文件夹为空）                            |
| `ext`                       | text        |                                 | 小写扩展名，便于筛选                               |
| `size`                      | bigint      | default 0                       | 字节（文件夹为子树聚合，异步维护）                 |
| `checksum`                  | text        |                                 | sha256，用于秒传                                   |
| `status`                    | node_status | default `active`                |                                                    |
| `deleted_at`                | timestamptz |                                 | 软删（回收站）                                     |
| `deleted_by`                | text        |                                 |                                                    |
| `is_favorite`               | boolean     | default false                   | 冗余，便于主列表排序                               |
| `meta`                      | jsonb       |                                 | 扩展信息：图片宽高、视频时长、缩略图 key、预览缓存 |
| `last_accessed_at`          | timestamptz |                                 |                                                    |
| `created_at` / `updated_at` | timestamptz | NOT NULL                        |                                                    |

**约束与索引**

```sql
-- 同目录同名唯一（未删除范围内）
CREATE UNIQUE INDEX file_node_name_uidx
  ON file_node (connection_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'), name)
  WHERE deleted_at IS NULL;

CREATE INDEX file_node_parent_idx  ON file_node (connection_id, parent_id, type);
CREATE INDEX file_node_owner_idx   ON file_node (owner_id);
CREATE INDEX file_node_name_idx    ON file_node (name text_pattern_ops);  -- 前缀搜索
CREATE INDEX file_node_checksum_idx ON file_node (checksum) WHERE checksum IS NOT NULL;
CREATE INDEX file_node_trash_idx   ON file_node (deleted_at) WHERE deleted_at IS NOT NULL;
```

**关系**

```ts
fileNode.selfRelation: one(parent) / many(children)  // 自引用
fileNode → connection (many-to-one)
fileNode → owner (many-to-one)
```

> 说明：跨连接「移动」= 复制 + 删除，由队列任务完成，不做跨连接硬链接。

---

## 6. 上传会话（7）

### `upload_session`

| 字段                        | 类型          | 约束              | 说明                                           |
| --------------------------- | ------------- | ----------------- | ---------------------------------------------- |
| `id`                        | uuid          | PK                | 前端持有，用于续传                             |
| `connection_id`             | uuid          | FK, NOT NULL      |                                                |
| `parent_id`                 | uuid          | FK→file_node      | 目标目录                                       |
| `user_id`                   | text          | FK→user, NOT NULL |                                                |
| `fingerprint`               | text          | NOT NULL          | `hash(name+size+lastModified+parentId+userId)` |
| `original_name`             | text          | NOT NULL          | 原始文件名（含路径，文件夹上传时含相对路径）   |
| `mime`                      | text          |                   |                                                |
| `size`                      | bigint        | NOT NULL          | 文件总大小                                     |
| `chunk_size`                | integer       | NOT NULL          | 单片字节数（默认 8MB）                         |
| `total_chunks`              | integer       | NOT NULL          |                                                |
| `uploaded_parts`            | jsonb         | default `[]`      | 已完成分片号数组（本地驱动）                   |
| `parts_meta`                | jsonb         | default `[]`      | `[{partNumber, etag, size}]`（S3 类）          |
| `provider_upload_id`        | text          |                   | COS/OSS/S3 的 multipart uploadId               |
| `storage_key`               | text          | NOT NULL          | 预生成的目标键                                 |
| `status`                    | upload_status | default `pending` |                                                |
| `error`                     | text          |                   |                                                |
| `expires_at`                | timestamptz   |                   | 超时未完成的临时分片由 GC 回收                 |
| `created_at` / `updated_at` | timestamptz   | NOT NULL          |                                                |

**索引**：`UNIQUE (user_id, fingerprint)` —— 同一用户对同一文件只存在一个进行中的会话（实现刷新恢复与秒传）；
`CREATE INDEX upload_session_status_idx ON upload_session (status, updated_at)`（GC 用）。

---

## 7. 分享（8–9）

### `share_link`

| 字段                        | 类型         | 约束                   | 说明                            |
| --------------------------- | ------------ | ---------------------- | ------------------------------- |
| `id`                        | uuid         | PK                     |                                 |
| `token`                     | text         | NOT NULL, UNIQUE       | 10 位短码，URL `/share/<token>` |
| `node_id`                   | uuid         | FK→file_node, NOT NULL | 可以是文件也可以是文件夹        |
| `created_by`                | text         | FK→user, NOT NULL      |                                 |
| `password_hash`             | text         |                        | scrypt 哈希；为空则无密码       |
| `expires_at`                | timestamptz  |                        |                                 |
| `max_downloads`             | integer      |                        | 为空不限                        |
| `download_count`            | integer      | default 0              |                                 |
| `can_preview`               | boolean      | default true           |                                 |
| `can_download`              | boolean      | default true           |                                 |
| `can_list`                  | boolean      | default true           | 文件夹分享是否允许列目录        |
| `status`                    | share_status | default `active`       |                                 |
| `last_accessed_at`          | timestamptz  |                        |                                 |
| `created_at` / `updated_at` | timestamptz  | NOT NULL               |                                 |

索引：`UNIQUE(token)`、`(created_by, created_at)`、`(node_id)`。

### `share_access_log`

| 字段                | 类型               | 说明                                              |
| ------------------- | ------------------ | ------------------------------------------------- |
| `id`                | uuid PK            |                                                   |
| `share_id`          | uuid FK→share_link |                                                   |
| `action`            | text               | `view` / `preview` / `download` / `password_fail` |
| `ip` / `user_agent` | text               |                                                   |
| `node_id`           | uuid               | 被访问的具体文件（文件夹分享时）                  |
| `created_at`        | timestamptz        |                                                   |

索引：`(share_id, created_at DESC)`。

---

## 8. 同步（10–11）

### `sync_job`

| 字段                                               | 类型          | 说明                     |
| -------------------------------------------------- | ------------- | ------------------------ |
| `id`                                               | uuid PK       |                          |
| `from_connection_id` / `to_connection_id`          | uuid FK       |                          |
| `created_by`                                       | text FK→user  |                          |
| `mode`                                             | text          | `full` / `incremental`   |
| `conflict_strategy`                                | sync_conflict | default `keep_both`      |
| `status`                                           | job_status    | default `pending`        |
| `total_files` / `processed_files` / `failed_files` | integer       |                          |
| `total_bytes` / `processed_bytes`                  | bigint        |                          |
| `progress`                                         | integer       | 0–100                    |
| `current_path`                                     | text          | 当前处理项，用于 UI 显示 |
| `error`                                            | text          |                          |
| `started_at` / `finished_at`                       | timestamptz   |                          |
| `created_at` / `updated_at`                        | timestamptz   |                          |

### `sync_job_item`

| 字段                                | 类型                      | 说明                                               |
| ----------------------------------- | ------------------------- | -------------------------------------------------- |
| `id`                                | uuid PK                   |                                                    |
| `job_id`                            | uuid FK→sync_job, cascade |                                                    |
| `source_node_id` / `target_node_id` | uuid                      |                                                    |
| `path`                              | text                      | 便于失败重试定位                                   |
| `status`                            | text                      | `pending`/`running`/`completed`/`failed`/`skipped` |
| `error`                             | text                      |                                                    |
| `created_at` / `updated_at`         | timestamptz               |                                                    |

索引：`(job_id, status)`。

---

## 9. 通用任务（12）

### `task`

| 字段                         | 类型         | 说明                                                      |
| ---------------------------- | ------------ | --------------------------------------------------------- |
| `id`                         | uuid PK      | 同时作为 BullMQ jobId                                     |
| `type`                       | task_type    | compress / extract / package_download / thumbnail / purge |
| `status`                     | task_status  | default `pending`                                         |
| `progress`                   | integer      | 0–100                                                     |
| `title`                      | text         | 展示名，如「压缩 相册.zip」                               |
| `payload`                    | jsonb        | 入参（nodeIds、目标目录、选项）                           |
| `result`                     | jsonb        | 出参（生成的 file_node_id、下载签名等）                   |
| `error`                      | text         |                                                           |
| `user_id`                    | text FK→user |                                                           |
| `started_at` / `finished_at` | timestamptz  |                                                           |
| `created_at` / `updated_at`  | timestamptz  |                                                           |

索引：`(user_id, created_at DESC)`、`(status)`。

> BullMQ 自身状态在 Redis；`task` 表是给前端查询与历史留痕用的持久镜像，worker 每次进度变更写回。

---

## 10. 设置与配置（13–14）

### `smtp_setting`（单条，`id = 1` 约定）

| 字段                       | 类型           | 说明          |
| -------------------------- | -------------- | ------------- |
| `id`                       | uuid PK        |               |
| `host` / `port`            | text / integer |               |
| `secure`                   | boolean        | 465 = true    |
| `user`                     | text           |               |
| `pass_enc`                 | text           | **加密**      |
| `from_name` / `from_email` | text           |               |
| `enabled`                  | boolean        | default false |
| `updated_by`               | text           |               |
| `updated_at`               | timestamptz    |               |

### `system_setting`（KV）

| 字段         | 类型        | 说明 |
| ------------ | ----------- | ---- |
| `key`        | text PK     |      |
| `value`      | jsonb       |      |
| `updated_at` | timestamptz |      |

预置键：

```
installed_at, version, default_connection_id,
upload_chunk_size, max_upload_size, allowed_extensions,
webdav_enabled, trash_retention_days, api_reference_enabled,
allow_folder_share, default_share_expire_days,
site_name, site_logo
```

---

## 11. 组织与便利功能（15–17）

### `favorite`

| 字段         | 类型                       | 说明 |
| ------------ | -------------------------- | ---- |
| `id`         | uuid PK                    |      |
| `user_id`    | text FK→user               |      |
| `node_id`    | uuid FK→file_node, cascade |      |
| `created_at` | timestamptz                |      |

`UNIQUE(user_id, node_id)`。

### `tag` / `file_tag`

- `tag`: `id uuid PK, name text UNIQUE, color text, created_at`
- `file_tag`: `node_id uuid, tag_id uuid, created_at`，`PRIMARY KEY(node_id, tag_id)`

---

## 12. WebDAV（18）

### `webdav_token`

| 字段           | 类型         | 说明                                |
| -------------- | ------------ | ----------------------------------- |
| `id`           | uuid PK      |                                     |
| `user_id`      | text FK→user |                                     |
| `name`         | text         | 备注，如「Mac Finder」              |
| `token_hash`   | text         | sha256(token)，明文仅创建时返回一次 |
| `last_used_at` | timestamptz  |                                     |
| `expires_at`   | timestamptz  | 可空=长期                           |
| `revoked_at`   | timestamptz  |                                     |
| `created_at`   | timestamptz  |                                     |

索引：`(user_id)`。

---

## 13. 审计（19）

### `audit_log`

| 字段                | 类型        | 说明                                                                                        |
| ------------------- | ----------- | ------------------------------------------------------------------------------------------- |
| `id`                | uuid PK     |                                                                                             |
| `user_id`           | text        | 可空（公开分享操作）                                                                        |
| `action`            | text        | `auth.login` / `file.delete` / `share.create` / `connection.set_default` / `admin.create` … |
| `target_type`       | text        | user / file_node / share_link / storage_connection                                          |
| `target_id`         | text        |                                                                                             |
| `ip` / `user_agent` | text        |                                                                                             |
| `meta`              | jsonb       | 补充信息（旧值、新值、数量）                                                                |
| `created_at`        | timestamptz |                                                                                             |

索引：`(user_id, created_at DESC)`、`(action)`、`(target_type, target_id)`。
保留策略：默认 180 天，由 `maintenance` 队列清理。

---

## 14. ER 关系速览

```
user ─1:N─▶ session / account
user ─1:N─▶ file_node(owner) / storage_connection(created_by)
user ─1:N─▶ share_link / task / sync_job / webdav_token / audit_log

storage_connection ─1:N─▶ file_node
file_node ─self─▶ file_node(parent/children)
file_node ─1:N─▶ share_link / sync_job_item / file_tag
file_node ─1:1─▶ upload_session(完成后关联)

share_link ─1:N─▶ share_access_log
sync_job   ─1:N─▶ sync_job_item
tag        ─N:M─▶ file_node (via file_tag)
```

---

## 15. 迁移与初始化

1. `packages/db/src/schema/` 下按域拆分：`auth.ts`、`storage.ts`、`file.ts`、`share.ts`、`sync.ts`、`system.ts`；`index.ts` 统一导出。
2. 迁移产物：`packages/db/src/migrations/`（当前为空，需首次 `db:generate`）。
3. CLI `install` 流程调用 `drizzle-kit push`（开发）或 `migrate`（生产，由 `SYSTEM_ENV` 决定）。
4. **初始数据**（install 时写入）：
   - `user`：founder 管理员（`pincman1988@gmail.com`，`role=founder`，`must_change_password=true`）
   - `storage_connection`：`name='local'`、`type='local'`、`is_default=true`、`root_prefix=''`
   - `system_setting`：`installed_at`、`version`、`default_connection_id`、`upload_chunk_size`、`trash_retention_days=30`、`webdav_enabled=true`
   - `file_node`：连接根目录下的空根（可选，用 `parent_id=null` 表示根，无需建记录）

---

## 16. 容量与性能注意

- `file_node` 随文件量线性增长，千万级需分区；本期按单表 + 索引设计，预留 `(connection_id)` 分区改造空间；
- `file_node.size` 对文件夹为聚合值，写入时异步刷新（队列），不实时精确；
- `storage_connection.total_size` 由 `maintenance` 队列每日重算；
- `upload_session` 完成即删除（或标记 completed 后 24h 清理），避免表膨胀；
- 大 JSON 字段（`meta`、`payload`、`result`）控制体积，超 64KB 的内容考虑外置。
