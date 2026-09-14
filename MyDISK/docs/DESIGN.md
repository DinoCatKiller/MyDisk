# MyDisk 私人云盘 · 总体架构设计

> 版本：v1.0（待评审）
> 日期：2026-09-14
> 关联文档：`docs/DATABASE.md`（数据库模型）、`docs/API.md`（oRPC 接口清单）

---

## 1. 目标与范围

### 1.1 产品定位

单用户/小团队自托管的**私人云盘（P-Storage）**：一个进程内可跑完的 Web 网盘 + 多存储后端统一网关 + 对外分享与 WebDAV 出口。

形态对标（仅模仿交互与信息架构，不照搬实现）：AList / Cloudreve / `file.3rcd.com` 一类的「左侧目录树 + 右侧文件列表 + 顶部工具栏 + 底部上传队列」。

### 1.2 已确认的关键决策

| 决策项    | 结论                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| 前端框架  | **保留 SolidJS 2 + Vite（SolidStart SSR）**，不使用 Next.js                                                              |
| UI 库     | **放弃 HeroUI**（React-only），改为 Tailwind v4 + CSS Modules 自研组件                                                   |
| 图标      | `lucide-solid`（Lucide 的 Solid 移植），不可用时回退内联 SVG                                                             |
| 字体      | Inter（拉丁）+ Noto Sans SC / 系统中文栈（"自然系"无衬线）                                                               |
| 后端      | Hono 独立服务 + oRPC                                                                                                     |
| 数据库    | PostgreSQL，库名 `pstorage`                                                                                              |
| 缓存/队列 | Redis + BullMQ                                                                                                           |
| 接口文档  | **OpenAPI**（`@orpc/openapi` 1.15），全部过程具备 REST 语义，输出 OpenAPI 3.1 + `/api-reference`；**不引入任何 AI 能力** |
| 环境      | 按 `postgres://postgres:123456@127.0.0.1:5432/pstorage`、`redis://127.0.0.1:6379` 编码，服务由使用方自行拉起             |
| 容器      | 不使用 Docker，不产出任何 docker 配置                                                                                    |

### 1.3 不在范围内（本期）

- 多租户 / 普通用户注册（系统只有管理员，无公开注册）
- 移动端原生 App（仅做响应式 Web）
- 文件在线协同编辑
- 分布式多节点部署（单实例 + 独立 worker 进程）

---

## 2. 技术栈定稿

| 层             | 选型                                             | 版本             | 备注                                                   |
| -------------- | ------------------------------------------------ | ---------------- | ------------------------------------------------------ |
| 运行时         | Bun                                              | 1.3.14           | 锁死，见 `packageManager`                              |
| 前端框架       | SolidJS / @solidjs/web                           | 2.0.0-rc.7       | 脚手架既有，保持不变                                   |
| 前端路由       | @solidjs/router                                  | 2.0.0-next.23    | 文件路由 filesystem-routing 0.3.0                      |
| 构建           | Vite                                             | 8.2.2            |                                                        |
| SSR / 部署适配 | Nitro                                            | 3.0.260903-beta  | `serverEntry: false`，纯 SSR + 中间件                  |
| 样式           | Tailwind CSS v4 + CSS Modules                    | 4.3.3            | v4 用 `@theme` 定义设计令牌，不用 `tailwind.config.js` |
| 图标           | lucide-solid                                     | latest           |                                                        |
| 数据请求       | oRPC + @orpc/tanstack-query                      | 1.15             |                                                        |
| 状态/缓存      | @tanstack/solid-query                            | 6.0.0-rc.3       |                                                        |
| 后端           | Hono                                             | 4.13.7           |                                                        |
| 校验           | Zod                                              | 4.5.4            | `@orpc/zod` Zod4 转换器                                |
| ORM            | Drizzle ORM + drizzle-kit                        | 0.45.2 / 0.31.10 |                                                        |
| 数据库         | PostgreSQL（node-postgres `pg`）                 | 8.23 驱动        | 库 `pstorage`                                          |
| 队列           | BullMQ + ioredis                                 | latest           |                                                        |
| 认证           | Better-Auth                                      | 1.7.3            | **关闭公开注册**                                       |
| 邮件           | nodemailer（SMTP）                               | latest           | 配置落库，可在线改                                     |
| OpenAPI        | @orpc/openapi + @orpc/zod（Zod4 转换器）         | 1.15             | 生成 OpenAPI 3.1 spec 与 `/api-reference` 文档站       |
| 对象存储 SDK   | cos-nodejs-sdk-v5 / ali-oss / @aws-sdk/client-s3 | latest           | 按需懒加载                                             |
| 压缩           | archiver（服务端）/ zip.js（客户端）             | latest           |                                                        |
| 文档解析       | mammoth（docx）/ exceljs（xlsx）/ pdf.js（前端） | latest           |                                                        |
| CLI            | yargs + @clack/prompts                           | latest           |                                                        |
| WebDAV         | 自研（基于 Hono 挂载 `/dav`）                    | —                | 见 §6.8                                                |

---

## 3. 进程与端口拓扑

```
                          ┌────────────────────────────────────────┐
   浏览器 ──:3001────────▶ │ apps/web   SolidStart (Vite+Nitro SSR) │
                          └───────────────┬────────────────────────┘
                                          │ oRPC  /rpc    （控制面）
                                          │ HTTP  /api/upload/* /api/raw/*（二进制面）
                                          ▼
                          ┌────────────────────────────────────────┐
                          │ apps/server  Hono  :3000               │
                          │  ├─ /rpc            oRPC 全量过程       │
                          │  ├─ /api/upload/*   分片上传/秒传        │
                          │  ├─ /api/raw/*      流式下载/预览(签名)  │
                          │  ├─ /dav            WebDAV             │
                          │  └─ /api-reference  OpenAPI 文档        │
                          └───┬──────────┬──────────┬──────────────┘
                              │          │          │
                     PostgreSQL│    Redis │          │ 存储驱动
                        :5432  │    :6379 │          ▼
                    ┌──────────▼──┐ ┌─────▼─────┐ ┌──────────────────┐
                    │  pstorage   │ │  BullMQ   │ │ Local / COS /    │
                    │  Drizzle    │ │  Queue    │ │ OSS / S3 兼容     │
                    └─────────────┘ └─────┬─────┘ └──────────────────┘
                                          │
                                  ┌───────▼────────┐
                                  │ apps/worker    │  独立进程，消费队列
                                  │ 合并/压缩/解压 │
                                  │ 同步/邮件      │
                                  └────────────────┘
```

**为什么要拆两个面（oRPC 与原生 HTTP）**：oRPC 是 JSON-RPC 语义，用它传 8MB 的分片要 base64 膨胀 33% 且内存翻倍。因此：

- **控制面**（init / complete / abort / 列目录 / 分享 / 设置 …）全部走 oRPC，享受端到端类型安全；
- **数据面**（分片上传、流式下载、预览取流）走 Hono 原生路由，带签名令牌鉴权，直接读写流。

这是本设计里最重要的一条工程约束。

---

## 4. 仓库目录规划

### 4.1 改造后结构

```
MyDISK/
├── apps/
│   ├── web/                    # 【改造】SolidStart 前端
│   │   └── src/
│   │       ├── routes/         # 文件路由
│   │       │   ├── index.tsx           # → 重定向到 /files 或 /login
│   │       │   ├── login.tsx           # 【重写】自研登录（删除脚手架注册能力）
│   │       │   ├── forgot-password.tsx # 找回密码（邮箱验证码）
│   │       │   ├── reset-password.tsx  # 重置密码（token）
│   │       │   ├── files/[...path].tsx # 文件管理器主页
│   │       │   ├── trash.tsx           # 回收站
│   │       │   ├── favorites.tsx       # 收藏
│   │       │   ├── settings/           # 设置：storage / smtp / webdav / security
│   │       │   ├── admin/users.tsx     # 管理员管理（创始人可用）
│   │       │   ├── share/[token].tsx   # 公开分享页（无登录）
│   │       │   └── [...404].tsx
│   │       ├── components/
│   │       │   ├── ui/                 # 自研基础组件（Button/Input/Modal/Table…）+ *.module.css
│   │       │   ├── file/               # FileList / FileGrid / FileTree / FileRow / ContextMenu
│   │       │   ├── upload/             # UploadDrawer / UploadItem / GlobalUploadControls
│   │       │   ├── preview/            # 各类型预览器
│   │       │   └── layout/             # Header / Sidebar / Breadcrumb
│   │       ├── lib/                    # auth-client / uploader / format / clipboard
│   │       ├── styles/                 # tokens.css（设计令牌）、global.css
│   │       └── utils/orpc.ts
│   ├── server/                 # 【改造】Hono + oRPC
│   │   └── src/
│   │       ├── index.ts                # 组装：oRPC + 上传路由 + 下载路由 + /dav + OpenAPI
│   │       ├── routes/upload.ts        # 分片上传（原生 HTTP）
│   │       ├── routes/raw.ts           # 签名下载/预览流（原生 HTTP，支持 Range）
│   │       ├── routes/dav.ts           # WebDAV 协议实现
│   │       ├── openapi.ts              # OpenAPI spec 生成 + /api-reference 配置
│   │       ├── context.ts / services.ts / env.ts
│   └── worker/                 # 【新增】BullMQ Worker 独立进程
│       └── src/index.ts
├── packages/
│   ├── api/                    # 【改造】oRPC 路由集合（见 docs/API.md）
│   │   └── src/routers/        # system / auth / connection / file / upload / share
│   │                           #   / task / sync / preview / smtp / webdav / audit
│   ├── auth/                   # 【改造】Better-Auth：禁注册、创始人角色、oRPC 封装
│   ├── db/                     # 【改造】Drizzle schema 大改（见 docs/DATABASE.md）
│   ├── storage/                # 【新增】存储抽象层
│   │   └── src/
│   │       ├── types.ts                # StorageDriver 接口
│   │       ├── index.ts                # createDriver(connection)
│   │       ├── drivers/local.ts        # 本地文件系统
│   │       ├── drivers/s3.ts           # S3 兼容（含 COS / OSS 的 S3 模式）
│   │       ├── drivers/cos.ts          # 腾讯云 COS 原生 SDK
│   │       ├── drivers/oss.ts          # 阿里云 OSS 原生 SDK
│   │       ├── key.ts                  # 物理键生成（unix 时间戳重命名）
│   │       └── multipart.ts            # 分片/断点续传能力协商
│   ├── queue/                  # 【新增】BullMQ 队列与 worker 注册
│   ├── mail/                   # 【新增】nodemailer 封装 + 模板
│   ├── webdav/                 # 【新增】WebDAV 方法实现（PROPFIND/GET/PUT/MOVE/DELETE…）
│   ├── cli/                    # 【新增】yargs CLI + cli.sh 生成器
│   │   └── src/
│   │       ├── index.ts                # yargs 主入口
│   │       ├── commands/               # install / passwd / admin / smtp / storage / db / serve
│   │       └── lib/cli-sh.ts           # 生成 cli.sh 的模板
│   └── config/                 # tsconfig.base.json
├── storage/                    # 【新增·运行期生成】本地存储根（.gitignore）
├── cli.sh                      # 【新增·由 install 生成】安装/运维入口
└── docs/                       # 本设计文档
```

### 4.2 依赖方向（严格单向，禁止反向引用）

```
web ─┐
     ├─▶ api ──▶ auth ──▶ db
server┤   ├────▶ storage
     │   ├────▶ queue
     │   └────▶ mail
worker──────▶ queue + storage + db + mail
cli ────────▶ db + auth + storage（不依赖 web/server）
```

---

## 5. 数据库模型

见 `docs/DATABASE.md`。共 **20 张表**（Better-Auth 原生 4 张 + 业务 16 张）。

---

## 6. 核心领域设计

### 6.1 存储抽象层（packages/storage）

```ts
interface StorageDriver {
  readonly type: "local" | "cos" | "oss" | "s3";
  // 基础
  put(key: string, body: ReadableStream | Buffer, opts?): Promise<PutResult>;
  get(key: string, range?: { start: number; end: number }): Promise<ReadableStream>;
  head(key: string): Promise<Stat | null>;
  delete(key: string): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  list(prefix: string, opts?): Promise<Stat[]>; // 非递归列举（本地需要）
  // 分片（可选能力）
  multipart?: {
    init(key: string, mime: string): Promise<string>; // 返回 uploadId
    uploadPart(key: string, uploadId: string, part: number, body): Promise<{ etag: string }>;
    complete(key: string, uploadId: string, parts): Promise<void>;
    abort(key: string, uploadId: string): Promise<void>;
    listParts(key: string, uploadId: string): Promise<number[]>;
  };
  // 直传/签名
  signDownloadUrl(key: string, ttl: number, filename?: string): Promise<string | null>;
  signUploadUrl?(key: string, ttl: number): Promise<string | null>;
}
```

**能力协商**：本地驱动自己实现「临时目录 + 合并」版 multipart；COS/OSS/S3 直接用原生 multipart。无 `signDownloadUrl` 能力时，一律走服务端 `/api/raw/*` 代理流（本地驱动即如此）。

**本地存储约束**：

- 类型 `local` 的连接**全局唯一**（服务层硬校验，第二创建直接报错）；
- 根目录固定为 `<项目根>/storage`，写入 `.gitignore`；
- 键名即相对路径，落盘前做路径穿越防护（`path.resolve` 后必须在 root 之内）。

**物理键生成（unix 时间戳重命名）**：

```
key = `${connectionId}/${yyyy}/${MM}/${Date.now()}-${rand8}${ext}`
例：c1a9.../2026/09/1757845200123-a3f9c2d1.png
```

原始文件名保存在 `file_node.name`，下载时通过 `Content-Disposition` 还原，用户无感。同目录重名由唯一索引 + 后缀策略处理（`name` 唯一索引在 `(connection_id, parent_id)` 上，冲突时自动追加 ` (1)`）。

**连接配置加密**：`storage_connection.config` 中的 `secretId/secretKey/accessKey` 用 AES-256-GCM 加密（密钥来自 `ENCRYPTION_KEY`），读取时解密；列表接口永不返回密钥原文，只回掩码 `AKID****abcd`。

### 6.2 上传：分片 / 断点续传 / 暂停停止 / 刷新续传

**时序**

```
前端                                    服务端
 │ 计算指纹 fp = hash(name+size+mtime+parentId)
 │── upload.init {fp, name, size, mime, parentId} ──▶ 建/复用 upload_session
 │◀── { uploadId, chunkSize, uploaded: [0,1,2…] } ────┘
 │
 │ for each 未传分片 i:
 │── PUT /api/upload/chunk?uploadId&i (raw body) ───▶ 写 .tmp/<uploadId>/<i> 或 UploadPart
 │◀── 200 { received: i, etag }
 │
 │── upload.complete { uploadId } ──────────────────▶ 合并 → 算 sha256 → 写 file_node
 │◀── { fileNode }
```

- **分片大小**：默认 8MB，`system_setting.uploadChunkSize` 可调；小于 8MB 的文件走单请求 `upload.simple`。
- **秒传**：`upload.init` 带 `sha256`，命中同 `connectionId` 且 `status=active` 的同哈希文件 → 直接建引用记录，返回 `instant: true`。
- **断点续传**：服务端以 `upload_session` 持久记录 `uploadedParts`（jsonb）。重连后 `upload.init` 同指纹即返回已传分片列表，前端跳过。
- **暂停 / 停止**：
  - 每项上传用独立 `XMLHttpRequest`（必须 XHR 而非 fetch，才能拿到 `upload.onprogress` 并 `abort()`）；
  - 暂停 = `xhr.abort()` + 本地状态 `paused`（服务端 session 保留，可无限期续传）；
  - 继续 = 重新 `init` 拿已传分片 → 从断点续传；
  - 停止 = `upload.abort { uploadId }`，服务端清理临时分片与 session，条目从当前上传列表消失；
  - 顶部「全部暂停 / 全部停止」作用于队列全部条目。
- **刷新后继续**（重点，含浏览器限制）：
  浏览器刷新后 `File` 对象丢失，这是平台限制，方案分三级：
  1. **首选**：使用 File System Access API（`showOpenFilePicker`）时，把 `FileSystemFileHandle` 存入 IndexedDB，刷新后经权限确认自动拿回文件 → **真正自动续传**；
  2. **回退**：通过 `<input type=file>` 选择的文件，把 `Blob` 存进 IndexedDB（≤ 约 500MB 可行，超过则只存元数据）；
  3. **兜底**：只恢复「待续传」条目并显示「继续（需重新选择文件）」，用户重选同名同大小文件时校验 `sha256` 前缀后从断点续传。
     上传队列本身（进度、状态、uploadId）持久化在 IndexedDB，刷新即重建。

### 6.3 文件管理

- 统一 `file_node` 树（`parent_id` 自引用），文件夹与文件同表；
- 移动/重命名：更新 `parent_id`/`name`，物理键**不变**（改名只改展示名，避免对象存储搬运）；跨连接移动 = 复制 + 删除（走队列任务）；
- 删除：软删进回收站（`deleted_at`），回收站再删 → 队列任务物理删除；
- 属性面板：大小、类型、真实路径（连接 + 物理键）、sha256、创建/修改/访问时间、分享状态；
- 搜索：按名称 `ILIKE` + 类型/时间/大小/标签过滤。

### 6.4 分享

- `share_link.token` 为 10 位短码（nanoid 字母数字），URL：`/share/<token>`；
- 支持：密码（scrypt 哈希）、有效期、下载次数上限、权限位（可预览/可下载/可列目录）；
- 文件夹分享：分享页呈现与管理端一致的目录树，可逐级进入、预览、单文件下载或整目录打包下载（队列任务 + 邮件/页面返回链接）；
- 访问记录落 `share_access_log`（IP、UA、时间、动作），可在管理端查看；
- 公开接口（无需登录）在 oRPC 中单独 `publicShareRouter`，权限由 token+password 决定。

### 6.5 多连接与同步

- 一个类型可建多个连接；`is_default` 唯一；
- **切换默认连接**时前端弹窗三选一：
  1. 立即同步（把旧连接全量文件复制到新连接）；
  2. 稍后同步（只切默认，`storage_connection.sync_status = pending`，设置页出现「立即同步」按钮）；
  3. 不同步（仅切默认，标记 `skipped`）；
- 同步任务：BullMQ `sync` 队列，逐文件复制（跨驱动用流式 `get → put`），记录 `sync_job_item`；
- 冲突策略默认 `keep_both`（同路径同名则新连接侧文件名加 ` (1)`），可切换 `overwrite` / `skip`；
- 任务可暂停/继续/取消，进度实时写入 `sync_job`（前端轮询或 SSE）。

### 6.6 压缩与解压

- **压缩**：默认客户端 `zip.js` 流式打包（省服务端带宽），大目录（>200 文件或 >1GB）自动切到服务端队列任务；
- **解压**：服务端队列任务（需遍历写盘），支持 zip / tar.gz，解压到指定目录，重名按 `keep_both`；
- 二者统一抽象为 `task` 记录，前端用同一套进度 UI。

### 6.7 预览

| 类型                   | 方案                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| 图片                   | 原生 `<img>`；大图走缩略图队列任务；支持左右切换与缩放                                                       |
| 视频                   | 原生 `<video>` + HTTP Range（服务端 `/api/raw` 必须支持 206）                                                |
| 音频                   | 原生 `<audio>` + Range                                                                                       |
| PDF                    | 前端 pdf.js                                                                                                  |
| Markdown               | 前端 marked + highlight.js + sanitize                                                                        |
| 代码/纯文本            | 前端分片读取 + 高亮（>2MB 只加载前 2MB）                                                                     |
| Office(docx/xlsx/pptx) | 服务端转 HTML（mammoth / exceljs），结果缓存到 `file_node.meta.previewCache`；或仅提供「下载后本地打开」兜底 |
| 其他                   | 显示类型图标 + 属性 + 下载按钮                                                                               |

下载与预览流统一走 `/api/raw/<fileNodeId>?token=<短时签名>&dl=1&inline=1`，签名 JWT 有效期 15 分钟，绑定 `fileNodeId` 与 `userId`（分享场景绑定 `shareId`）。

### 6.8 WebDAV

- 挂在主服务 `/dav`，Basic Auth；
- 支持方法：`PROPFIND` `GET` `HEAD` `PUT` `DELETE` `MOVE` `COPY` `MKCOL` `OPTIONS`；`LOCK` 返回成功空实现（兼容 macOS Finder / Windows 资源管理器）；
- 认证方式二选一：管理员账号密码，或 `webdav_token` 生成的专用令牌（可撤销）；
- 目录映射：根 = 默认连接根；多连接时按 `/<连接名>/...` 分层；
- 大文件 PUT 走流式直写存储驱动，不经内存。

### 6.9 认证与管理员体系

- **Better-Auth 保留，但改造成「只服务管理员」**：
  - 关闭公开注册（`emailAndPassword.disableSignUp = true`）；
  - 前端不再直连 `/api/auth/*`，一律走 oRPC `authRouter`（服务端调 `auth.api.*`，把 Better-Auth 返回的 `Set-Cookie` 通过 Hono context 回写）；
  - 删除脚手架的 `login.tsx` / `sign-in-form.tsx` / `sign-up-form.tsx`，全部重写。
- **角色**：
  - `founder`：安装时创建的第一个管理员（且仅一个），不可删除、不可降级；
  - `admin`：由 founder 在后台创建，可被 founder 删除；无法删除或降级 founder；
  - 删除保护在服务层硬校验（不依赖前端）。
- **能力**：登录、登出、改密（需校验原密码）、绑定/更换邮箱（验证码）、找回密码（SMTP 邮件链接）、首次登录强制改密（`must_change_password`）。
- **审计**：所有敏感操作写 `audit_log`。

### 6.10 邮件（SMTP）

- 配置落 `smtp_setting` 单条记录，管理端在线编辑 + 「发送测试邮件」；
- 用途：密码重置、邮箱绑定验证码、安全告警（异地登录/密码变更）；
- 发送走 BullMQ `mail` 队列，失败重试 3 次（指数退避）；
- 密码字段 AES 加密存储，接口永不回明文。

### 6.11 OpenAPI 与接口文档

> 说明：需求中的「openai」实为 **OpenAPI**。因此本系统**不引入任何 AI 能力**，改为把全部接口以 OpenAPI 3.1 规范化输出。

**双协议同源码**：所有 oRPC 过程在定义时附加 `.route()`，同时具备 RPC 与 REST 两种语义：

```ts
export const list = protectedProcedure
  .route({
    method: "GET",
    path: "/files",
    summary: "列出目录内容",
    description: "按父目录分页列出文件与文件夹，支持关键字与类型过滤",
    tags: ["file"],
  })
  .input(listInput)
  .handler(({ input, context }) => fileService.list(context.db, input));
```

- 前端依旧走 `/rpc`（类型安全、批量、低样板）；
- 外部系统与文档走 REST 路径 + `/api-reference`。

**端点**

| 端点                          | 说明                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| `/rpc`                        | oRPC RPC 入口（前端主用）                                            |
| `/api-reference`              | `OpenAPIReferencePlugin` 渲染的交互式文档（Scalar 主题）             |
| `/openapi.json`               | 由 `OpenAPIGenerator` 生成的 spec，Redis 缓存 5 分钟，随路由变更失效 |
| `/api/upload/*`、`/api/raw/*` | 二进制面，**不经过 oRPC**，需在 spec 中补充声明（见下）              |

**二进制路由的文档化**：分片上传与流式下载不走 oRPC，无法自动推导 schema。做法是在 `apps/server/src/openapi.ts` 中维护一段**手写 spec 片段**（`paths` 的补充项：请求为 `application/octet-stream`、响应 206/200、鉴权为签名 token），在生成最终 spec 时与 oRPC 自动生成的 `paths` 合并，保证文档覆盖 100% 接口。

**鉴权 scheme**：spec 中声明两种 security scheme —— `cookieAuth`（管理员会话）与 `bearerAuth`（WebDAV 令牌 / 分享访问令牌），每个操作标注所需 scheme；公开过程（分享访问、登录）标注 `security: []`。

**规范约定**

- 所有过程的 `input` / `output` 必须由 Zod 定义（否则无法转 JSON Schema）；返回二进制或流的接口不放进 oRPC；
- 路径风格：`/connections`、`/files`、`/shares`、`/tasks`、`/system`，资源复数，动词仅用于非 CRUD（如 `/files/{id}/move`）；
- 每个操作必填 `summary` 与 `tags`，`tags` 与 router 名一致（system/auth/connection/file/upload/share/task/preview/smtp/webdav）；
- 错误响应统一使用 §1.2 的错误码枚举，在 spec 中以 `components.schemas.ErrorResponse` 呈现。

**收益**：可直接用 openapi-generator 生成任意语言 SDK；`/api-reference` 也是调试上传/下载之外所有接口的最快途径。

---

## 7. 队列与任务模型

**队列（BullMQ）**

| 队列名        | 任务                          | 并发 | 说明                            |
| ------------- | ----------------------------- | ---- | ------------------------------- |
| `upload`      | 分片合并、秒传校验、缩略图    | 4    | 完成后回调更新 `upload_session` |
| `archive`     | 压缩 / 解压                   | 2    | 长任务，进度写 `task`           |
| `sync`        | 连接间同步                    | 2    | 可暂停                          |
| `mail`        | 发信                          | 8    | 重试 3 次                       |
| `maintenance` | 回收站清理、临时分片 GC、统计 | 1    | 定时 repeatable                 |

**统一 `task` 表**：所有长任务在 `task` 建记录（type/status/progress/result/error），前端统一轮询 `task.list` 与 `task.get`，UI 复用同一进度组件。

---

## 8. CLI 与安装流程

### 8.1 `cli.sh`

由 `install` 命令在**项目根目录**生成（幂等，已存在则跳过）：

```bash
#!/usr/bin/env bash
# MyDisk / P-Storage 运维入口
set -euo pipefail
cd "$(dirname "$0")"

MARK="node_modules/.pstorage-installed"

if [ ! -f "$MARK" ]; then
  echo "→ 首次运行，正在安装依赖…"
  bun install
  bun run packages/cli/src/index.ts install
else
  bun run packages/cli/src/index.ts "$@"
fi
```

- 已安装 → 直接把参数透传给 yargs 模块；
- 未安装 → 先 `bun install`，再自动进入 `install` 子命令（建表 + 设管理员）；
- `chmod +x` 由生成逻辑处理；Windows 下提供 `cli.ps1` 同逻辑（PowerShell 版）。

### 8.2 yargs 命令树

```bash
./cli.sh                      # 无参 → 交互式主菜单（@clack/prompts）
./cli.sh install              # 安装：生成 cli.sh → bun install → 建表 → 设置管理员
./cli.sh passwd [--email x]   # 更新管理员密码（交互选择/指定邮箱）
./cli.sh admin:add            # 新增管理员
./cli.sh admin:list           # 列出管理员（标注 founder）
./cli.sh admin:remove --email # 删除管理员（拒绝删除 founder）
./cli.sh smtp:set             # 交互式配置 SMTP
./cli.sh smtp:test --to x     # 发送测试邮件
./cli.sh storage:add          # 新增存储连接（交互式选类型、填配置并连通性测试）
./cli.sh storage:list         # 列出连接（标注默认）
./cli.sh storage:default --id # 切换默认连接（提示是否同步）
./cli.sh storage:sync --from --to
./cli.sh db:push | db:studio | db:generate
./cli.sh serve                # 启动 web+server（turbo run dev）
./cli.sh worker               # 启动 worker
./cli.sh openapi              # 导出 openapi.json 到 ./openapi.json
```

### 8.3 install 流程（严格两步）

```
1. 生成 ./cli.sh（+ cli.ps1），写 .gitignore 之外的标记
2. bun install
   ↓
3. 调用 yargs 交互模块：
   ├─ 数据库连接自检（连不上给出明确提示并退出，不静默失败）
   ├─ 建表（drizzle-kit push / migrate）
   ├─ 管理员账户/密码/邮箱设置
   │   └─ 默认值（非交互 --yes 时使用）：
   │       用户名/邮箱：pincman1988@gmail.com
   │       密码：12345678
   │       角色：founder
   ├─ 建立默认本地连接（type=local，root=<root>/storage，is_default=true）
   ├─ 写 system_setting：installedAt / version / defaultConnectionId
   └─ 写标记 node_modules/.pstorage-installed
```

> 默认口令仅用于本地首次进入。系统对 founder 默认置 `must_change_password = true`，登录后可关闭。

---

## 9. 前端信息架构（Solid）

### 9.1 页面

| 路由                     | 内容                                                          |
| ------------------------ | ------------------------------------------------------------- |
| `/login`                 | 自研登录（邮箱+密码；忘记密码入口）                           |
| `/forgot-password`       | 输入邮箱 → 队列发重置邮件                                     |
| `/reset-password?token=` | 设置新密码                                                    |
| `/files/[...path]`       | 主界面：左侧连接+目录树，右侧文件区，顶部工具栏，底部上传抽屉 |
| `/trash`                 | 回收站（还原 / 彻底删除 / 清空）                              |
| `/favorites`             | 收藏                                                          |
| `/settings/storage`      | 连接列表、新增/编辑/测试/设为默认/同步                        |
| `/settings/smtp`         | SMTP 配置与测试                                               |
| `/settings/api`          | OpenAPI 文档入口、spec 下载、外部集成说明                     |
| `/settings/webdav`       | 开关 + 令牌管理                                               |
| `/settings/security`     | 改密、绑定邮箱、会话管理                                      |
| `/admin/users`           | 管理员列表/新增/删除（founder 专属）                          |
| `/share/[token]`         | 公开分享页（密码门禁 → 目录/预览/下载）                       |

### 9.2 关键组件

- `ui/`：Button、IconButton、Input、Select、Switch、Modal、Drawer、Dropdown、Tooltip、Progress、Table、Tabs、Toast、Skeleton、EmptyState —— 每个配同名 `*.module.css`
- `file/`：`FileTree`（虚拟滚动）、`FileList` / `FileGrid`（切换）、`FileRow`（右键菜单：下载/分享/重命名/移动/删除/属性）、`Breadcrumb`、`DropZone`（全窗口拖拽）
- `upload/`：`UploadDrawer`（队列）、`UploadItem`（单文件进度 + 悬停出现**暂停/停止**图标按钮；暂停后图标变「继续」）、`GlobalUploadControls`（顶部整体暂停/停止/清空已完成）
- `preview/`：`PreviewModal` + `ImagePreview` / `VideoPreview` / `PdfPreview` / `MarkdownPreview` / `TextPreview` / `OfficePreview` / `FallbackPreview`

### 9.3 上传队列状态机

```
pending ─▶ uploading ─▶ paused ─▶ uploading ─▶ completed
   │           │            │
   │           ├─▶ stopped（从列表移除）
   │           └─▶ error ─▶ (重试) ─▶ uploading
   └──▶ stopped
```

悬停交互按需求实现：鼠标移到单条记录上出现「暂停 / 停止」两个按钮；点击暂停 → 变「继续」，暂停传输；点继续 → 变「暂停」，继续；点停止 → 终止并移除该条。

---

## 10. 视觉与样式规范

- **设计令牌**（`src/styles/tokens.css` + Tailwind v4 `@theme`）：主色（靛蓝系）、中性灰阶、圆角（10/14px）、阴影（软阴影两层）、间距节奏 4px 基准、亮/暗双主题（CSS 变量切换）；
- **CSS Modules** 负责组件级结构与复杂布局，Tailwind 只做原子级微调与响应式；禁止在 JSX 里堆超长 class 串；
- **字体**：`Inter` 为主，`Noto Sans SC` / `PingFang SC` / `Microsoft YaHei` 为中文回退；等宽用 `JetBrains Mono`（文件名、路径、代码预览）；
- **图标**：`lucide-solid`，统一 18/20px 两种尺寸，与文字基线对齐；
- **参考视觉方向**：AList/Cloudreve 那种干净、留白充足、列表信息密度高的文件管理器观感（只借鉴布局与节奏，不复制其视觉资产）。

---

## 11. 环境变量清单

### `apps/server/.env.schema`

| 变量                    | 必填 | 说明                                                      |
| ----------------------- | ---- | --------------------------------------------------------- |
| `NODE_ENV`              | ✓    | development/production/test                               |
| `PORT`                  |      | 默认 3000                                                 |
| `SERVER_URL`            | ✓    | 服务端对外地址                                            |
| `CORS_ORIGIN`           | ✓    | 前端地址                                                  |
| `DATABASE_URL`          | ✓    | 默认 `postgres://postgres:123456@127.0.0.1:5432/pstorage` |
| `REDIS_URL`             | ✓    | 默认 `redis://127.0.0.1:6379`                             |
| `BETTER_AUTH_SECRET`    | ✓    | ≥32 位                                                    |
| `BETTER_AUTH_URL`       | ✓    |                                                           |
| `ENCRYPTION_KEY`        | ✓    | 32 字节，用于加密存储密钥与 SMTP 密码                     |
| `STORAGE_ROOT`          |      | 本地存储根，默认 `<root>/storage`                         |
| `UPLOAD_CHUNK_SIZE`     |      | 默认 8388608（8MB）                                       |
| `API_REFERENCE_ENABLED` |      | 默认 true；生产可关闭 `/api-reference` 与 `/openapi.json` |
| `WEBDAV_ENABLED`        |      | 默认 true                                                 |

### `apps/web/.env.schema`

| 变量              | 说明                         |
| ----------------- | ---------------------------- |
| `VITE_SERVER_URL` | 默认 `http://localhost:3000` |
| `NODE_ENV`        |                              |

> 改 schema 后必须 `bun run env:generate`（Varlock 生成 `src/env.ts`）。

---

## 12. 安全设计

1. 所有密钥（存储 AK/SK、SMTP 密码）AES-256-GCM 加密落库，接口只回掩码；
2. 下载/预览一律短时签名 JWT（15 分钟），绑定资源与主体；
3. 分享密码用 scrypt 哈希，校验失败计数 + 冷却；
4. 路径穿越防护：所有 key 经 `resolve` 后必须落在连接根内；
5. 上传校验：扩展名白名单可配、单文件大小上限、Content-Type 嗅探与扩展名一致性检查；
6. 全量敏感操作写 `audit_log`（含 IP/UA）；
7. 登录失败限流（Redis 计数，15 分钟 10 次锁定）；
8. 会话 Cookie：`httpOnly + secure + sameSite=lax`（生产）；
9. 生产环境可通过 `API_REFERENCE_ENABLED=false` 关闭 `/api-reference` 与 `/openapi.json`，避免暴露接口结构。

---

## 13. 分期实施计划

| 阶段                  | 内容                                                                                                            | 验收点                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **P0 地基**           | 改造 db schema + 迁移；storage 抽象与本地驱动；queue/mail/cli 包骨架；OpenAPI spec 生成与 `/api-reference`      | `db:push` 通过，本地驱动单测通过，`/api-reference` 能打开  |
| **P1 骨架可跑**       | 删除脚手架登录注册，重写登录页；oRPC authRouter（登录/登出/会话）；管理端布局；CLI install + cli.sh；默认管理员 | `./cli.sh install` 一次跑通，能登录进主界面                |
| **P2 上传与文件管理** | 分片上传 + 断点续传 + 刷新续传；暂停/停止/整体控制；目录树、列表/网格、拖拽、移动/重命名/删除/属性、回收站      | 断网重连能从断点续传；刷新后队列恢复                       |
| **P3 存储与分享**     | COS/OSS/S3 驱动；多连接与切换同步；分享（密码/文件夹/预览/下载）；预览全家桶；压缩解压；BullMQ 全面接入         | 三类云存储各跑通一次上传下载；切换连接同步完成             |
| **P4 增强**           | WebDAV；管理员体系与审计；SMTP 找回密码；OpenAPI spec 补全与 SDK 生成脚本；UI 精修与暗色主题                    | WebDAV 能用系统文件管理器挂载；`openapi.json` 覆盖全部接口 |

---

## 14. 已识别风险与应对

| 风险                                  | 影响               | 应对                                                                                       |
| ------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| Solid 2 / Router / Nitro 全为 RC/beta | API 可能变动       | 锁定 `overrides` 版本；关键用法（如 `createRouter`、`Loading`、`onSettled`）先写最小验证页 |
| 刷新后续传受浏览器限制                | 需求核心项         | 三级方案（File System Access → IndexedDB Blob → 重选文件），UI 明确告知当前处于哪一级      |
| 大文件分片走 oRPC 性能差              | 上传吞吐           | 二进制面强制走原生 Hono 路由（已在架构层隔离）                                             |
| 二进制路由脱离 oRPC                   | OpenAPI 文档不完整 | 手写 spec 片段与自动生成结果合并，CI 校验「接口数 = 文档路径数」                           |
| 本地连接唯一性                        | 数据一致性         | 服务层硬约束 + DB 部分唯一索引（见 DATABASE.md）                                           |
| 弱口令默认管理员                      | 安全               | founder 首次登录强制改密，CLI 提供 `passwd` 随时改                                         |
| Windows 无 bash                       | `cli.sh` 不可用    | 同时生成 `cli.ps1`，文档给出 Git Bash / WSL 两种执行方式                                   |

---

## 15. 待你确认的遗留问题（阻塞编码前的最后几点）

1. **默认管理员用户名**：你写「用户名是 pincman」，但系统登录拟用**邮箱**为主标识。是否改为 `email = pincman1988@gmail.com`、`name = pincman`？
2. **OpenAPI 暴露范围**：`/api-reference` 与 `/openapi.json` 默认开启（推荐），生产可用 `API_REFERENCE_ENABLED=false` 关闭？
3. **WebDAV 端口**：挂在主服务 `/dav` 路径（推荐，少开端口）还是独立 3002？
4. **中文文件名与目录**：按 UTF-8 原样存储（推荐）还是转拼音？
5. **回收站保留期**：默认 30 天自动清理，还是永久保留手动清空？

以上 5 点我都有默认答案（1=是，2=默认开启，3=主服务路径，4=原样 UTF-8，5=30 天）。你不回复即按默认执行，进入 P0+P1 编码。

> 已确认移除：~~AI / OpenAI 能力~~。需求中的「openai」为 **OpenAPI** 之误，本系统不引入任何 AI 功能，改为完整输出 OpenAPI 3.1 接口文档（见 §6.11）。
