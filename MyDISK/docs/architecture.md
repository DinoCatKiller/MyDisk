# A1 · 架构与分层

|        |                                                               |
| ------ | ------------------------------------------------------------- |
| ID     | `A1`                                                          |
| 类型   | 规格                                                          |
| 状态   | 稳定                                                          |
| 更新   | 2026-10-15                                                    |
| 何时读 | 新建模块、改目录结构 / 依赖方向、改部署与端口、改安全与限流时 |
| 规模   | ~4k token                                                     |

## TL;DR

- 形态：**单进程单端口 `:3000`**——TanStack Start（Solid）承载页面与 SSR，Hono 作为 `/api` 子系统直挂其内；后面挂 PostgreSQL(:5432) / Redis(:6379) / 存储驱动；`apps/worker` 独立进程消费队列。
- 两层接口面（`D3`）：**控制面走 oRPC `/api/rpc`**（类型安全），**数据面走原生 HTTP**（`/api/upload/*`、`/api/raw/*`、`/dav`，签名令牌鉴权）。
- 依赖方向硬单向：`apps/* → packages/* → packages/config`，禁止反向。
- 二进制路由不走 oRPC，其 OpenAPI 覆盖靠 `apps/web/src/server/openapi.ts` 手写 spec 片段合并。
- 端口：单 app `3000`；不使用 Docker。

## 1. 进程与端口拓扑

```
                          ┌────────────────────────────────────────┐
   浏览器 ──:3000────────▶ │ 单 app  :3000                          │
                          │ TanStack Start (Solid) + Vite（SSR）   │
                          │  ├─ 页面路由（SSR 出 html 壳）          │
                          │  └─ Hono /api 子系统（直挂，不改 path） │
                          │      ├─ /api/rpc          oRPC 全量过程 │
                          │      ├─ /api/upload/*     分片上传/秒传  │
                          │      ├─ /api/raw/*        流式下载/预览  │
                          │      ├─ /dav              WebDAV        │
                          │      └─ /api/reference    OpenAPI 文档  │
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

> `apps/worker`、`/dav`、`/api/upload/*`、`/api/raw/*` 在 P0/P1 尚未落地，属 P2–P4（见 `RM`）。

**为什么拆两个面（oRPC 与原生 HTTP）**：oRPC 是 JSON-RPC 语义，用它传 8MB 分片会 base64 膨胀 33% 且内存翻倍。因此：

- **控制面**（init / complete / abort / 列目录 / 分享 / 设置 …）全部走 oRPC，享受端到端类型安全；
- **数据面**（分片上传、流式下载、预览取流）走 Hono 原生路由，带签名令牌鉴权，直接读写流。

这是本设计里最重要的一条工程约束（决策与备选 → `D3`）。

## 2. 仓库目录与依赖方向

### 2.1 目录结构

```
MyDISK/
├── apps/
│   ├── web/                    # TanStack Start 单 app（README + docs/ui.md = A5）
│   │   └── src/server/         # Hono + oRPC 装配，直挂为 `/api` 子系统（README）
│   └── worker/                 # ⬜ P3 新增：BullMQ Worker 独立进程
├── packages/
│   ├── api/                    # oRPC 路由集合（README + docs/routers.md = A3）
│   ├── auth/                   # Better-Auth 封装：禁注册、founder、oRPC 封装
│   ├── db/                     # Drizzle schema 与客户端（README + docs/schema.md = A2）
│   ├── storage/                # 存储抽象层（README + docs/driver.md = A4）
│   ├── queue/                  # BullMQ 队列与 worker 注册
│   ├── mail/                   # nodemailer 封装 + 模板
│   ├── cli/                    # yargs CLI + cli.sh / cli.ps1 生成器
│   ├── webdav/                 # ⬜ P4 新增：WebDAV 方法实现
│   └── config/                 # tsconfig.base.json
├── storage/                    # ⬜ 运行期生成：本地存储根（.gitignore）
├── cli.sh / cli.ps1            # 安装 / 运维入口（由 install 生成）
└── docs/                       # 跨模块文档（G1 / A1 / A6 / RM / index / decisions）
```

### 2.2 依赖方向（严格单向，禁止反向引用）

```
web ───▶ api ──▶ auth ──▶ db
          ├────▶ storage
          ├────▶ queue
          └────▶ mail
worker───▶ queue + storage + db + mail
cli ─────▶ db + auth + storage（不依赖 web）
```

硬约束：`packages/*` **不得** import `apps/*`。违反即在评审中打回。

## 3. 数据模型

见 `A2`（`packages/db/docs/schema.md`）：共 **19 张表**（Better-Auth 原生 4 张 + 业务 15 张）。本文件不重复。

## 4. 队列与任务模型

**队列（BullMQ）**

| 队列名        | 任务                          | 并发 | 说明                            |
| ------------- | ----------------------------- | ---- | ------------------------------- |
| `upload`      | 分片合并、秒传校验、缩略图    | 4    | 完成后回调更新 `upload_session` |
| `archive`     | 压缩 / 解压                   | 2    | 长任务，进度写 `task`           |
| `sync`        | 连接间同步                    | 2    | 可暂停                          |
| `mail`        | 发信                          | 8    | 重试 3 次                       |
| `maintenance` | 回收站清理、临时分片 GC、统计 | 1    | 定时 repeatable                 |

**统一 `task` 表**：所有长任务在 `task` 建记录（type/status/progress/result/error），前端统一轮询 `task.list` / `task.get`，UI 复用同一进度组件。

## 5. CLI 与安装流程

### 5.1 入口脚本

由 `install` 命令在**项目根目录**生成 `cli.sh`（幂等，已存在则跳过）；Windows 侧同步生成 `cli.ps1`（同逻辑）。

- 已安装 → 直接把参数透传给 yargs 模块；
- 未安装 → 先 `bun install`，再自动进入 `install` 子命令（建表 + 设管理员）。

### 5.2 yargs 命令树

```bash
./cli.sh                      # 无参 → 交互式主菜单（@clack/prompts）
./cli.sh install              # 安装：生成 cli.sh → bun install → 建表 → 设置管理员
./cli.sh passwd [--email x]   # 更新管理员密码
./cli.sh admin:add|list|remove
./cli.sh smtp:set|test        # ⬜ P4
./cli.sh storage:add|list|default|sync   # ⬜ P3
./cli.sh db:push|studio|generate
./cli.sh serve                # 启动单 app（turbo run dev）
./cli.sh worker               # ⬜ P3
./cli.sh openapi              # 导出 openapi.json
```

### 5.3 install 流程（严格两步）

```
1. 生成 ./cli.sh（+ cli.ps1）
2. bun install
   ↓
3. yargs 交互：
   ├─ 数据库连接自检（连不上明确提示并退出，不静默失败）
   ├─ 建表（drizzle-kit push / migrate）
   ├─ 管理员账户/密码/邮箱设置（默认值见 A2 §15；role=founder）
   ├─ 建立默认本地连接（type=local, root=<root>/storage, is_default=true）
   └─ 写 system_setting：installedAt / version / defaultConnectionId
```

> 默认口令仅用于本地首次进入；founder 默认 `must_change_password=true`。

## 6. 环境变量清单

### `apps/web/.env.schema`（唯一来源）

| 变量                    | 必填 | 说明                                                        |
| ----------------------- | ---- | ----------------------------------------------------------- |
| `NODE_ENV`              | ✓    | development / production / test                             |
| `DATABASE_URL`          | ✓    | 默认 `postgres://postgres:123456@127.0.0.1:5432/pstorage`   |
| `REDIS_URL`             | ✓    | 默认 `redis://127.0.0.1:6379`                               |
| `BETTER_AUTH_SECRET`    | ✓    | ≥32 位                                                      |
| `BETTER_AUTH_URL`       | ✓    | 指向单 app，默认 `http://localhost:3000`                    |
| `ENCRYPTION_KEY`        | ✓    | 32 字节，用于加密存储密钥与 SMTP 密码（`A4`）               |
| `STORAGE_ROOT`          |      | 本地存储根，默认 `<root>/storage`                           |
| `UPLOAD_CHUNK_SIZE`     |      | 默认 8388608（8MB）                                         |
| `API_REFERENCE_ENABLED` |      | 默认 true；生产可关 `/api/reference` 与 `/api/openapi.json` |
| `WEBDAV_ENABLED`        |      | 默认 true                                                   |
| `PORT`                  |      | 运行期读取，默认 3000（单端口）                             |

> 改 schema 后必须 `bun run env:generate`（Varlock 生成 `src/env.ts`）。

## 7. 安全设计

1. 所有密钥（存储 AK/SK、SMTP 密码）AES-256-GCM 加密落库，接口只回掩码（`A4`）；
2. 下载/预览一律短时签名 JWT（15 分钟），绑定资源与主体；
3. 分享密码用 scrypt 哈希，校验失败计数 + 冷却；
4. 路径穿越防护：所有 key 经 `resolve` 后必须落在连接根内；
5. 上传校验：扩展名白名单可配、单文件大小上限、Content-Type 嗅探与扩展名一致性检查；
6. 全量敏感操作写 `audit_log`（含 IP/UA）；
7. 登录失败限流（Redis 计数，15 分钟 10 次锁定）；
8. 会话 Cookie：`httpOnly + secure + sameSite`（生产 `none/secure`，开发 `lax`）；
9. 生产可用 `API_REFERENCE_ENABLED=false` 关闭 `/api/reference` 与 `/api/openapi.json`。

## 8. 已识别风险与应对

| 风险                                  | 影响               | 应对                                                                |
| ------------------------------------- | ------------------ | ------------------------------------------------------------------- |
| Solid 2 / TanStack Start / Router 全为 RC/beta | API 可能变动       | 锁定 `overrides` 版本；关键用法先写最小验证页                       |
| 刷新后续传受浏览器限制                | 需求核心项         | 三级方案（File System Access → IndexedDB Blob → 重选文件）；见 `X1` |
| 大文件分片走 oRPC 性能差              | 上传吞吐           | 二进制面强制走原生 Hono 路由（`D3`）                                |
| 二进制路由脱离 oRPC                   | OpenAPI 文档不完整 | 手写 spec 片段与自动生成结果合并，CI 校验「接口数 = 文档路径数」    |
| 本地连接唯一性                        | 数据一致性         | 服务层硬约束 + DB 部分唯一索引（`A2` §4）                           |
| 弱口令默认管理员                      | 安全               | founder 首次登录强制改密，CLI 提供 `passwd`                         |
| Windows 无 bash                       | `cli.sh` 不可用    | 同时生成 `cli.ps1`，文档给出 Git Bash / WSL 两种执行方式            |

## 相关

- 决策：`D3`（双协议面）｜`D4`（管理员体系）｜`D5`（OpenAPI）
- 契约：`A2`（数据模型）｜`A3`（接口）｜`A4`（存储）
- 排期：`RM` ｜ 未决项 → `S2`
