# G1 · 目标、技术路线、自研边界

|        |                                                                  |
| ------ | ---------------------------------------------------------------- |
| ID     | `G1`                                                             |
| 类型   | 规格                                                             |
| 状态   | 稳定                                                             |
| 更新   | 2026-10-15                                                       |
| 何时读 | 争论「要不要自研 / 先做哪个 / 用什么技术栈」时；对外介绍本项目时 |
| 规模   | ~2k token                                                        |

## TL;DR

- 产品：**单用户 / 小团队自托管的私人云盘（P-Storage）**——一个进程内可跑完的 Web 网盘 + 多存储后端统一网关 + 分享与 WebDAV 出口。
- 形态对标 AList / Cloudreve / `file.3rcd.com`（只借鉴交互与信息架构，**不照搬实现**）。
- 技术路线：**Bun + SolidJS 2 + Hono + oRPC + Drizzle/PostgreSQL + Redis/BullMQ**（版本基线见 §3；为什么这么选 → `D1`/`D2`）。
- 自研边界：**前端组件、WebDAV 协议、存储抽象**自研；对象存储走官方 SDK；**不引入 AI 能力**（`D5`）。
- 不做：多租户 / 公开注册、移动端原生 App、在线协同编辑、分布式多节点、Docker。

## 1. 产品定位

单用户 / 小团队自托管的私人云盘：一个进程内可跑完的 Web 网盘 + 多存储后端统一网关 + 对外分享与 WebDAV 出口。

形态对标（仅模仿交互与信息架构，不照搬实现）：AList / Cloudreve / `file.3rcd.com` 一类的「左侧目录树 + 右侧文件列表 + 顶部工具栏 + 底部上传队列」。

### 不在范围内（本期）

- 多租户 / 普通用户注册（系统只有管理员，无公开注册 → `D4`）
- 移动端原生 App（仅做响应式 Web）
- 文件在线协同编辑
- 分布式多节点部署（单实例 + 独立 worker 进程）
- Docker（**不产出任何 docker 配置**）

## 2. 环境与运行约定

- 按 `postgres://postgres:123456@127.0.0.1:5432/pstorage`、`redis://127.0.0.1:6379` 编码；PostgreSQL / Redis 由使用方自行拉起，不随项目分发。
- 不使用 Docker。
- 运行时锁 **Bun 1.3.14**（`packageManager`）。

## 3. 技术栈定稿（版本基线）

> 选型**理由与备选**在 ADR（`D1` 通用栈 / `D2` 前端）；本表只给版本基线。改基线属技术栈变更，需先写 ADR。

| 层             | 选型                                             | 版本             | 备注                                               |
| -------------- | ------------------------------------------------ | ---------------- | -------------------------------------------------- |
| 运行时         | Bun                                              | 1.3.14           | 锁死，见 `packageManager`                          |
| 前端框架       | SolidJS / @solidjs/web                           | 2.0.0-rc.7       | 脚手架既有                                         |
| 前端路由       | @solidjs/router                                  | 2.0.0-next.23    | 文件路由 filesystem-routing 0.3.0                  |
| 构建           | Vite                                             | 8.2.2            |                                                    |
| SSR / 部署适配 | Nitro                                            | 3.0.260903-beta  | `serverEntry: false`，纯 SSR + 中间件              |
| 样式           | Tailwind CSS v4 + CSS Modules                    | 4.3.3            | v4 用 `@theme` 定义令牌，不用 `tailwind.config.js` |
| 图标           | lucide-solid                                     | latest           | 不可用时回退内联 SVG                               |
| 数据请求       | oRPC + @orpc/tanstack-query                      | 1.15             |                                                    |
| 状态/缓存      | @tanstack/solid-query                            | 6.0.0-rc.3       |                                                    |
| 后端           | Hono                                             | 4.13.7           |                                                    |
| 校验           | Zod                                              | 4.5.4            | `@orpc/zod` Zod4 转换器                            |
| ORM            | Drizzle ORM + drizzle-kit                        | 0.45.2 / 0.31.10 |                                                    |
| 数据库         | PostgreSQL（`pg` 驱动）                          | 8.23             | 库 `pstorage`                                      |
| 队列           | BullMQ + ioredis                                 | latest           |                                                    |
| 认证           | Better-Auth                                      | 1.7.3            | **关闭公开注册**（`D4`）                           |
| 邮件           | nodemailer（SMTP）                               | latest           | 配置落库、可在线改                                 |
| OpenAPI        | @orpc/openapi + @orpc/zod                        | 1.15             | 输出 OpenAPI 3.1 + `/api-reference`（`D5`）        |
| 对象存储 SDK   | cos-nodejs-sdk-v5 / ali-oss / @aws-sdk/client-s3 | latest           | 按需懒加载                                         |
| 压缩           | archiver（服务端）/ zip.js（客户端）             | latest           |                                                    |
| 文档解析       | mammoth / exceljs / pdf.js                       | latest           |                                                    |
| CLI            | yargs + @clack/prompts                           | latest           |                                                    |
| WebDAV         | 自研（基于 Hono 挂载 `/dav`）                    | —                | 见 `A6` §6.8                                       |

## 4. 自研边界

| 领域                                      | 自研                                 | 用现成                        |
| ----------------------------------------- | ------------------------------------ | ----------------------------- |
| 前端基础组件（Button/Input/Modal/Table…） | ✅ 自研（Tailwind v4 + CSS Modules） | 弃 HeroUI（React-only，`D2`） |
| 数据请求层                                | —                                    | ✅ oRPC + TanStack Query      |
| 存储抽象                                  | ✅ `packages/storage`（`A4`）        | 云驱动用官方 SDK              |
| WebDAV 协议                               | ✅ 自研（`A6` §6.8）                 | —                             |
| ORM / 迁移                                | —                                    | ✅ Drizzle + drizzle-kit      |
| 认证                                      | 封装为 oRPC（`A3` §3）               | ✅ Better-Auth                |
| 队列 / 发信                               | 编排自研                             | ✅ BullMQ、nodemailer         |
| AI 能力                                   | ❌ 不引入                            | —（`D5`）                     |

## 相关

- 决策：`D1`（通用技术栈）｜ `D2`（前端与 UI）｜ `D4`（管理员体系）｜ `D5`（OpenAPI 非 AI）
- 架构落法：`A1` ｜ 里程碑：`RM` ｜ 前端形态：`A5`
