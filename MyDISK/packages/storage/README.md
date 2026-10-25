# @MyDISK/storage · 存储驱动抽象，把文件落到 local / 云

|        |                                                                                                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态   | ✅ 已落地（P0 本地驱动；P3 接入 COS / OSS / S3 云驱动 + 契约测试 `bun test`）                                                                        |
| 边界   | 负责驱动接口与本地实现、物理键生成、分片能力、密钥加密/脱敏、路径穿越防护；**不含**上传编排与取流（在 `server`/`@MyDISK/api`）、连接 CRUD（在 `A3`） |
| 上游   | 无业务包（云驱动依赖 `@aws-sdk/client-s3`、`cos-nodejs-sdk-v5`、`ali-oss` 三家官方 SDK；本地场景不引入运行时开销可后续改惰性加载）                   |
| 下游   | `api`、`server`、`cli`（`encryptSecret`）、`worker`（P3，⬜）                                                                                        |
| 何时读 | 加驱动、改物理键 / 加密                                                                                                                              |

## 这个 crate 是什么

一块**换插座的插排**：上层只认 `StorageDriver` 这套接口，底下插本地磁盘还是 COS/OSS/S3，由 `createStorageDriver` 决定。

## 核心内容

| 项                            | 说明                                                                                                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                | `createStorageDriver(connection, { localRoot })`：按类型返回 `LocalStorageDriver` / `CosDriver` / `OssDriver` / `S3Driver`；云连接密钥从 `connection.config`（已解密）按类型约定取用；`DEFAULT_LOCAL_ROOT = "storage"` |
| `src/types.ts`                | `StorageDriver`（`put`/`get`/`head`/`delete`/`deleteMany`/`copy`/`list`/`readAll`/`signDownloadUrl` + `supportsMultipart`/`multipart`）、`MultipartCapability`、`StorageConnectionLike`、`RangeOption`                 |
| `src/drivers/local.ts`        | 本地实现；`resolve()` 校验所有键必须落在连接根内；分片暂存于 `<root>/.tmp/<connectionId>/<uploadId>`                                                                                                                   |
| `src/key.ts`                  | `buildStorageKey`：`<connectionId>/<yyyy>/<MM>/<unixMs>-<rand><ext>`；`buildTempPrefix`                                                                                                                                |
| `src/crypto.ts`               | AES-256-GCM `encryptSecret`/`decryptSecret`（`iv.tag.payload` base64）；`maskSecret` 脱敏                                                                                                                              |
| `src/errors.ts`               | `StorageError` + 错误码枚举（`NOT_FOUND`/`PATH_TRAVERSAL`/`NOT_IMPLEMENTED`/`UPLOAD_SESSION_INVALID` 等）                                                                                                              |
| `src/drivers/{s3,cos,oss}.ts` | 云驱动（P3）：S3 兼容（MinIO/私有部署 path-style）、COS、OSS；分片走各家原生 multipart；下载直链 `signDownloadUrl`（本地恒 `null`）；body 统一缓冲为 Buffer（分片 ≤ 8MB 上界可控）                                     |
| `test/drivers.test.ts`        | 契约测试（`bun test`）：本地回归 + S3 驱动对 s3rver 全链路（put/get/range/copy/list/multipart/签名直链带中文文件名）；s3rver 3.7.1 缺 ListParts/Abort 与带 Delimiter 的 Prefix，用 `S3_TEST_S3RVER=0` 关闭豁免         |

## 必须知道的三个设计决定

1. **物理键重命名，不用原名**：时间戳 + 随机后缀，规避中文/特殊字符、同名冲突与路径注入。原名存在 `file_node.name`，下载时用 `Content-Disposition` 还原。
2. **本地驱动用「临时目录 + 顺序合并」模拟 multipart（`A4` §2）**：本地文件系统没有原生分片；`listParts` 读 `.part` 文件即可支持断点续传。
3. **`signDownloadUrl` 本地返回 `null`**：本地无直链，一律由服务端代理流式输出；只有云驱动才返回直链——调用方必须按 `null` 分支处理。

## 相关

- 存储契约 → 本模块 `docs/driver.md`（`A4`）｜ `D3` ｜ `A1` §7 ｜ `A6`
- 地图 → `AGENTS.md` §2
