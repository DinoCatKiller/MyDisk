# A5 · 前端信息架构与视觉规范

|        |                                              |
| ------ | -------------------------------------------- |
| ID     | `A5`                                         |
| 类型   | 规格                                         |
| 状态   | 稳定（P1 已落布局与登录；各页面随 P2+ 填充） |
| 更新   | 2026-10-19                                   |
| 何时读 | 加页面、加组件、改布局 / 样式 / 主题前       |
| 规模   | ~2.5k token                                  |

## TL;DR

- 路由采用 TanStack Router 文件式路由，页面清单见 §1；`/files/$`（`_splat` 参数）是主界面。
- 取数走**路由 `loader`**（首屏 SSR 直出），会话由根路由 `beforeLoad` 服务端解析后注入路由 context（`D8`）；写法见 §1.1。
- 视觉方向：AList / Cloudreve 那种**干净、留白充足、列表信息密度高**的文件管理器观感（只借鉴布局与节奏，不复制其视觉资产）。
- 样式分工：**Tailwind v4（`@theme` 定义令牌）做原子微调，CSS Modules 管组件结构与复杂布局**；禁止在 JSX 里堆超长 class 串。
- 上传队列状态机见 `A6` §2.3；上传交互（暂停/停止/续传）细节属 `A6`。
- 组件均为**自研**（`D2`），无 React 生态 UI 库。

## 1. 页面（路由）

| 路由                     | 内容                                                          | 现状                                               |
| ------------------------ | ------------------------------------------------------------- | -------------------------------------------------- |
| `/login`                 | 自研登录（邮箱+密码；忘记密码入口）                           | ✅ P1                                              |
| `/forgot-password`       | 输入邮箱 → 队列发重置邮件                                     | ⬜ P4                                              |
| `/reset-password?token=` | 设置新密码                                                    | ⬜ P4                                              |
| `/files/$`（`_splat`）   | 主界面：左侧连接+目录树，右侧文件区，顶部工具栏，底部上传抽屉 | ✅ P2（path 段为节点 id + `loader` 预取，见 `apps/web/README.md`） |
| `/trash`                 | 回收站（还原 / 彻底删除 / 清空）                              | 🚧 骨架                                            |
| `/favorites`             | 收藏                                                          | 🚧 骨架                                            |
| `/shares`                | 分享管理                                                      | 🚧 骨架                                            |
| `/settings/storage`      | 连接列表、新增/编辑/测试/设为默认/同步                        | 🚧 骨架                                            |
| `/settings/smtp`         | SMTP 配置与测试                                               | ⬜ P4                                              |
| `/settings/api`          | OpenAPI 文档入口、spec 下载、外部集成说明                     | ⬜ P4                                              |
| `/settings/webdav`       | 开关 + 令牌管理                                               | ⬜ P4                                              |
| `/settings/security`     | 改密、绑定邮箱、会话管理                                      | 🚧 骨架                                            |
| `/admin/users`           | 管理员列表/新增/删除（founder 专属）                          | 🚧 骨架                                            |
| `/share/[token]`         | 公开分享页（密码门禁 → 目录/预览/下载）                       | ⬜ P3                                              |
| `/[...404]`              | 404                                                           | ✅ P1                                              |

## 1.1 路由与数据装载（`D8`）

- **首屏取数走路由 `loader`**：`loader` 经 `createServerFn`（`src/server/fns.ts`）调用 oRPC —— SSR 时在**进程内直调**（`@orpc/server` 的 `call`，无 HTTP 往返），客户端导航时走 serverFn 的 HTTP 端点；因此首屏 HTML 即含真实数据。
- **会话经根路由 `beforeLoad` 注入**：`__root` 的 `beforeLoad` 服务端读请求 Cookie 解析会话，`return { session }` 注入**路由 context**。`getRouter()` 由 Start **按请求实例化**，context 跟随请求隔离，SSR 期间不会跨请求串号。未登录访问受保护页 → `throw redirect({ to: "/login", replace: true })`（307）。
- **组件读数据**：会话用 `useSession()`（`src/lib/session.ts`，取 `__root` context 的 `session`）；页面数据用 `Route.useLoaderData()`；**不引入** `@tanstack/solid-query`。
- **变更后刷新**：改密 / 改资料 / 账户增删等用 `router.invalidate()` 重跑 `beforeLoad` + `loader`；文件区筛选 / 排序等纯客户端交互仍由 `client.*` 本地重取覆盖 loader 数据。

## 2. 关键组件

- `ui/`：Button、IconButton、Input、Select、Switch、Modal、Drawer、Dropdown、Tooltip、Progress、Table、Tabs、Toast、Skeleton、EmptyState —— 每个配同名 `*.module.css`。
- `file/`：`FileTree`（虚拟滚动）、`FileList` / `FileGrid`（切换）、`FileRow`（右键菜单：下载/分享/重命名/移动/删除/属性）、`Breadcrumb`、`DropZone`（全窗口拖拽）。
- `upload/`：`UploadDrawer`（队列）、`UploadItem`（单文件进度 + 悬停出现**暂停/停止**图标按钮；暂停后图标变「继续」）、`GlobalUploadControls`（顶部整体暂停/停止/清空已完成）。
- `preview/`：`PreviewModal` + `ImagePreview` / `VideoPreview` / `PdfPreview` / `MarkdownPreview` / `TextPreview` / `OfficePreview` / `FallbackPreview`。
- `layout/`：`AppShell` / `Header` / `Sidebar` / `Protected`（登录门禁）。

> 现状：`ui/` 已落 `button`/`input`/`card`/`alert`/`icons`；`layout/` 已落 `app-shell`/`protected`/`placeholder`。
> P2 已落 `file/`（`toolbar`/`breadcrumb`/`file-list`/`file-row`/`drop-zone`）与 `upload/`（`upload-drawer`）。`preview/` 与 `FileGrid` 网格留待后续。

## 3. 上传队列状态机

```
pending ─▶ uploading ─▶ paused ─▶ uploading ─▶ completed
   │           │            │
   │           ├─▶ stopped（从列表移除）
   │           └─▶ error ─▶ (重试) ─▶ uploading
   └──▶ stopped
```

悬停交互：鼠标移到单条记录上出现「暂停 / 停止」两个按钮；点暂停 → 变「继续」，暂停传输；点继续 → 变「暂停」，继续；点停止 → 终止并移除该条。（状态机细节与刷新续传三级方案见 `A6` §2。）

> **实现（`D7` / `X1` §3）**：上图由 `xstate` v5 落地——`apps/web/src/lib/upload/item.machine.ts`（每文件机）+ `pool.machine.ts`（池编排器，`maxParallelFiles=3`），二者挂**模块级**单例（`store.ts`），刷新不丢队列；刷新续传载体为 **C 级（仅元数据 + 重选续传）**（`S2` #3）。

## 4. 视觉与样式规范

- **设计令牌**（`src/styles/tokens.css` + Tailwind v4 `@theme`）：主色（靛蓝系）、中性灰阶、圆角（10/14px）、阴影（软阴影两层）、间距节奏 4px 基准、亮/暗双主题（CSS 变量切换）。
- **CSS Modules** 负责组件级结构与复杂布局，Tailwind 只做原子级微调与响应式；**禁止在 JSX 里堆超长 class 串**。
- **字体**：`Inter` 为主，`Noto Sans SC` / `PingFang SC` / `Microsoft YaHei` 为中文回退；等宽用 `JetBrains Mono`（文件名、路径、代码预览）。
- **图标**：`lucide-solid`，统一 18/20px 两种尺寸，与文字基线对齐。
- **参考视觉方向**：干净、留白充足、列表信息密度高的文件管理器观感。

## 相关

- 决策：`D2`（SolidJS + 自研 UI）｜ 功能交互：`A6` ｜ 接口调用：`A3` §15
- 模块门面：`apps/web/README.md` ｜ 未决项 → `S2`
