# A6 · 领域功能规格

|        |                                                                         |
| ------ | ----------------------------------------------------------------------- |
| ID     | `A6`                                                                    |
| 类型   | 规格                                                                    |
| 状态   | 草案（P2+ 逐步落地，见 `RM`）                                           |
| 更新   | 2026-10-15                                                              |
| 何时读 | 实现上传 / 文件管理 / 分享 / 同步 / 压缩解压 / 预览 / WebDAV 任一功能前 |
| 规模   | ~4k token                                                               |

## TL;DR

- 本文件是**尚未归属到具体模块的业务功能**的规格总集（上传、文件树、分享、同步、压缩解压、预览、WebDAV）。
- 存储抽象（机制）不在本文，见 `A4`；认证 / 发信 / OpenAPI 归各自模块（`packages/auth`、`packages/mail`、`A3`）。
- 上传核心：8MB 分片 + `upload_session` 持久化断点续传 + **刷新后续传三级方案**（浏览器限制，见 `X1`）。
- 文件管理：统一 `file_node` 树、软删回收站、跨连接移动 = 复制 + 删除（走队列）。
- 所有长任务（压缩/解压/打包/缩略图/清理）统一进 `task` 表，前端复用同一进度 UI。

## 1. 功能全景

| 功能                   | 归属模块（现状）                                                 | 阶段  | 规格            |
| ---------------------- | ---------------------------------------------------------------- | ----- | --------------- |
| 存储抽象               | `packages/storage`                                               | ✅ P0 | `A4`            |
| 认证与管理员           | `packages/auth` + `packages/api`                                 | ✅ P1 | `A3` §3 ｜ `D4` |
| 系统设置 / 审计        | `packages/api`                                                   | ✅ P1 | `A3` §2         |
| 上传（分片/续传/秒传） | `apps/server` + `packages/api` + `web`                           | 🚧 P2 | 本文 §2         |
| 文件管理 / 回收站      | `packages/api` + `web`                                           | 🚧 P2 | 本文 §3         |
| 分享                   | `packages/api` + `web`                                           | ⬜ P3 | 本文 §4         |
| 多连接与同步           | `packages/api` + `queue`                                         | ⬜ P3 | 本文 §5         |
| 压缩 / 解压            | `queue` + `web`                                                  | ⬜ P3 | 本文 §6         |
| 预览                   | `apps/server` + `web`                                            | ⬜ P3 | 本文 §7         |
| WebDAV                 | `apps/server`（+ ⬜ `packages/webdav`）                          | ⬜ P4 | 本文 §8         |
| 邮件（SMTP）           | `packages/mail`（transporter + 模板已落地，配置落库 / 收口待做） | 🚧 P4 | 本文 §9         |
| OpenAPI 文档           | `apps/server`                                                    | 🚧 P1 | `A3` §11        |

## 2. 上传：分片 / 断点续传 / 暂停停止 / 刷新续传

### 2.1 时序

```
前端                                    服务端
 │ 计算指纹 fp = hash(name+size+mtime+parentId+userId)
 │── upload.init {fp, name, size, mime, parentId} ──▶ 建/复用 upload_session
 │◀── { uploadId, chunkSize, uploaded: [0,1,2…] } ────┘
 │
 │ for each 未传分片 i:
 │── PUT /api/upload/chunk?uploadId&index (raw body) ─▶ 写 .tmp/<uploadId>/<i> 或 UploadPart
 │◀── 200 { received: i, etag }
 │
 │── upload.complete { uploadId } ──────────────────▶ 合并 → 算 sha256 → 写 file_node
 │◀── { fileNode }
```

### 2.2 规则

- **分片大小**：默认 8MB，`system_setting.upload_chunk_size` 可调；小于 8MB 的文件走单请求 `upload.simple`。
- **秒传**：`upload.init` 带 `sha256`，命中同 `connectionId` 且 `status=active` 的同哈希文件 → 直接建引用记录，返回 `instant: true`。
- **断点续传**：服务端以 `upload_session.uploaded_parts`（jsonb）持久记录已完成分片；重连后 `upload.init` 同指纹即返回已传列表，前端跳过。
- **暂停 / 停止**：
  - 每项上传用独立 `XMLHttpRequest`（**必须 XHR 而非 fetch**，才能拿到 `upload.onprogress` 并 `abort()`）；
  - 暂停 = `xhr.abort()` + 本地状态 `paused`（服务端 session 保留，可无限期续传）；
  - 继续 = 重新 `init` 拿已传分片 → 从断点续传；
  - 停止 = `upload.abort { uploadId }`，服务端清理临时分片与 session，条目从列表消失；
  - 顶部「全部暂停 / 全部停止」作用于队列全部条目。
- **刷新后继续**（重点，含浏览器限制）：浏览器刷新后 `File` 对象丢失，方案分三级：
  1. **首选**：File System Access API（`showOpenFilePicker`）时把 `FileSystemFileHandle` 存入 IndexedDB，刷新后经权限确认自动拿回文件 → **真正自动续传**；
  2. **回退**：`<input type=file>` 选择的文件，把 `Blob` 存进 IndexedDB（≤ 约 500MB 可行，超过则只存元数据）；
  3. **兜底**：只恢复「待续传」条目并显示「继续（需重新选择文件）」，用户重选同名同大小文件时校验 `sha256` 前缀后从断点续传。
     上传队列本身（进度、状态、uploadId）持久化在 IndexedDB，刷新即重建。

### 2.3 上传队列状态机（前端）

```
pending ─▶ uploading ─▶ paused ─▶ uploading ─▶ completed
   │           │            │
   │           ├─▶ stopped（从列表移除）
   │           └─▶ error ─▶ (重试) ─▶ uploading
   └──▶ stopped
```

悬停交互：鼠标移到单条记录出现「暂停 / 停止」两按钮；点暂停 → 变「继续」；点停止 → 终止并移除该条。

> 未决：三级方案的落地取舍与浏览器覆盖 → 见 `X1`（待写）与 `S2`。

## 3. 文件管理

- 统一 `file_node` 树（`parent_id` 自引用），文件夹与文件同表。
- 移动 / 重命名：更新 `parent_id` / `name`，**物理键不变**（改名只改展示名，避免对象存储搬运）；跨连接移动 = 复制 + 删除（走队列任务）。
- 删除：软删进回收站（`deleted_at`）；回收站再删 → 队列任务物理删除（`purge`）。
- 属性面板：大小、类型、真实路径（连接 + 物理键）、sha256、创建/修改/访问时间、分享状态。
- 搜索：按名称 `ILIKE` + 类型 / 时间 / 大小 / 标签过滤。

## 4. 分享

- `share_link.token` 为 10 位短码（nanoid 字母数字），URL：`/share/<token>`。
- 支持：密码（scrypt 哈希）、有效期、下载次数上限、权限位（可预览 / 可下载 / 可列目录）。
- 文件夹分享：分享页呈现与管理端一致的目录树，可逐级进入、预览、单文件下载或整目录打包下载（队列任务 + 邮件/页面返回链接）。
- 访问记录落 `share_access_log`（IP、UA、时间、动作），可在管理端查看。
- 公开接口（无需登录）在 oRPC 中单独 `publicShareRouter`，权限由 token + password 决定（`A3` §8）。

## 5. 多连接与同步

- 一个类型可建多个连接；`is_default` 唯一；`type=local` 全库唯一（`A2` §4）。
- **切换默认连接**时前端弹窗三选一：
  1. 立即同步（把旧连接全量文件复制到新连接）；
  2. 稍后同步（只切默认，`sync_status = pending`，设置页出现「立即同步」按钮）；
  3. 不同步（仅切默认，标记 `skipped`）。
- 同步任务：BullMQ `sync` 队列，逐文件复制（跨驱动用流式 `get → put`），记录 `sync_job_item`。
- 冲突策略默认 `keep_both`（同路径同名则新连接侧文件名加 ` (1)`），可切 `overwrite` / `skip`。
- 任务可暂停/继续/取消，进度实时写入 `sync_job`（前端轮询或 SSE）。

## 6. 压缩与解压

- **压缩**：默认客户端 `zip.js` 流式打包（省服务端带宽），大目录（>200 文件或 >1GB）自动切到服务端队列任务。
- **解压**：服务端队列任务（需遍历写盘），支持 zip / tar.gz，解压到指定目录，重名按 `keep_both`。
- 二者统一抽象为 `task` 记录，前端用同一套进度 UI。

## 7. 预览

| 类型                   | 方案                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| 图片                   | 原生 `<img>`；大图走缩略图队列任务；支持左右切换与缩放                                                  |
| 视频 / 音频            | 原生 `<video>` / `<audio>` + HTTP Range（`/api/raw` 必须支持 206）                                      |
| PDF                    | 前端 pdf.js                                                                                             |
| Markdown               | 前端 marked + highlight.js + sanitize                                                                   |
| 代码 / 纯文本          | 前端分片读取 + 高亮（>2MB 只加载前 2MB）                                                                |
| Office(docx/xlsx/pptx) | 服务端转 HTML（mammoth / exceljs），结果缓存到 `file_node.meta.preview_cache`；或「下载后本地打开」兜底 |
| 其他                   | 显示类型图标 + 属性 + 下载按钮                                                                          |

下载与预览统一走 `/api/raw/<fileNodeId>?token=<短时签名>&dl=1&inline=1`，签名 JWT 15 分钟，绑定 `fileNodeId` 与 `userId`（分享场景绑定 `shareId`）。

## 8. WebDAV

- 挂在主服务 `/dav`，Basic Auth。
- 支持方法：`PROPFIND` `GET` `HEAD` `PUT` `DELETE` `MOVE` `COPY` `MKCOL` `OPTIONS`；`LOCK` 返回成功空实现（兼容 macOS Finder / Windows 资源管理器）。
- 认证二选一：管理员账号密码，或 `webdav_token` 专用令牌（可撤销，明文仅创建时返回一次）。
- 目录映射：根 = 默认连接根；多连接时按 `/<连接名>/...` 分层。
- 大文件 PUT 走流式直写存储驱动，不经内存。

## 9. 认证与邮件（归模块，仅索引）

- **认证与管理员体系** → `packages/auth`（README）+ `A3` §3 + 决策 `D4`：禁公开注册、founder 唯一、敏感操作写 `audit_log`。
- **邮件（SMTP）** → `packages/mail`（README）：配置落 `smtp_setting` 单条记录、管理端在线编辑 + 测试；用途为密码重置 / 邮箱验证码 / 安全告警；走 BullMQ `mail` 队列，失败重试 3 次（指数退避）；密码字段 AES 加密。

## 10. OpenAPI 接口文档化

全部接口以 OpenAPI 3.1 输出（决策 `D5`）。双协议、tag / 路径规范、二进制路由手写 spec 补充等约定 → `A3` §11，本文不重复。

## 相关

- 机制契约：`A4`（存储）｜`A2`（数据模型）｜`A3`（接口）
- 决策：`D3`（双协议面）｜`D4`（管理员）｜`D5`（OpenAPI）
- 前端形态与状态机：`A5` ｜ 排期：`RM` ｜ 未决项 → `S2`
