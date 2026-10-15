# @MyDISK/storage · 存储驱动抽象，把文件落到 local / 云

|        |                                                                                                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态   | ✅ 已落地（P0，仅 `local` 驱动）                                                                                                                     |
| 边界   | 负责驱动接口与本地实现、物理键生成、分片能力、密钥加密/脱敏、路径穿越防护；**不含**上传编排与取流（在 `server`/`@MyDISK/api`）、连接 CRUD（在 `A3`） |
| 上游   | 无业务包（仅 Node 内置能力）                                                                                                                         |
| 下游   | `api`、`server`、`cli`（`encryptSecret`）、`worker`（P3，⬜）                                                                                        |
| 何时读 | 加驱动、改物理键 / 加密                                                                                                                              |

## 这个 crate 是什么

一块**换插座的插排**：上层只认 `StorageDriver` 这套接口，底下插本地磁盘还是 COS/OSS/S3，由 `createStorageDriver` 决定。

## 核心内容

| 项                     | 说明                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`         | `createStorageDriver(connection, { localRoot })`：`local` 返回 `LocalStorageDriver`；`cos`/`oss`/`s3` 抛 `NOT_IMPLEMENTED`（P3）；`DEFAULT_LOCAL_ROOT = "storage"`                                     |
| `src/types.ts`         | `StorageDriver`（`put`/`get`/`head`/`delete`/`deleteMany`/`copy`/`list`/`readAll`/`signDownloadUrl` + `supportsMultipart`/`multipart`）、`MultipartCapability`、`StorageConnectionLike`、`RangeOption` |
| `src/drivers/local.ts` | 本地实现；`resolve()` 校验所有键必须落在连接根内；分片暂存于 `<root>/.tmp/<connectionId>/<uploadId>`                                                                                                   |
| `src/key.ts`           | `buildStorageKey`：`<connectionId>/<yyyy>/<MM>/<unixMs>-<rand><ext>`；`buildTempPrefix`                                                                                                                |
| `src/crypto.ts`        | AES-256-GCM `encryptSecret`/`decryptSecret`（`iv.tag.payload` base64）；`maskSecret` 脱敏                                                                                                              |
| `src/errors.ts`        | `StorageError` + 错误码枚举（`NOT_FOUND`/`PATH_TRAVERSAL`/`NOT_IMPLEMENTED`/`UPLOAD_SESSION_INVALID` 等）                                                                                              |

## 必须知道的三个设计决定

1. **物理键重命名，不用原名**：时间戳 + 随机后缀，规避中文/特殊字符、同名冲突与路径注入。原名存在 `file_node.name`，下载时用 `Content-Disposition` 还原。
2. **本地驱动用「临时目录 + 顺序合并」模拟 multipart（`A4` §2）**：本地文件系统没有原生分片；`listParts` 读 `.part` 文件即可支持断点续传。
3. **`signDownloadUrl` 本地返回 `null`**：本地无直链，一律由服务端代理流式输出；只有云驱动才返回直链——调用方必须按 `null` 分支处理。

## 相关

- 存储契约 → 本模块 `docs/driver.md`（`A4`）｜ `D3` ｜ `A1` §7 ｜ `A6`
- 地图 → `AGENTS.md` §2
