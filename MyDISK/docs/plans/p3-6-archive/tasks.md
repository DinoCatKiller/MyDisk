# P3-6 任务清单

> 规格：`docs/plans/p3-6-archive/spec.md`。按顺序执行，每项完成即更新状态。

- [x] T1 上下文与队列：`Context.redisUrl`、web 注入、`lib/archive-queue.ts`、api 依赖 `@MyDISK/queue`
- [x] T2 API 契约：`schemas/task.ts`、`routers/archive.ts`（task.* + archive.*）、挂载 `appRouter`
- [x] T3 API 补齐：`file.copy` + `file.search`（schemas + 实现）
- [x] T4 分享打包：`schemas/share.ts` + `public.package` / `public.task`
- [x] T5 二进制面：task 原始令牌 + `routes/task-raw.ts` + `app.ts` 注册
- [x] T6 Worker 归档库：`zip-writer` / `zip-reader` / `tar-reader` / `archive-tree` + zip 回环测试
- [x] T7 Worker 处理器：`processors/archive.ts` + `index.ts` 注册
- [x] T8 前端：FileRow 压缩/解压、文件夹打包下载、`TaskProgress` 组件、分享页打包
- [x] T9 文档同批：routers.md / queue README / worker README / features.md / STATUS.md / AGENTS.md
- [ ] T10 验证：tsc ×3 + check + zip 测试 + 烟测；中文 commit 并汇报
