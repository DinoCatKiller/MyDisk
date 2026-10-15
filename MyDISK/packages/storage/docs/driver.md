# A4 · 存储抽象契约

|        |                                                  |
| ------ | ------------------------------------------------ |
| ID     | `A4`                                             |
| 类型   | 规格（契约）                                     |
| 状态   | 稳定（P0 已落地本地驱动；COS/OSS/S3 于 P3 接入） |
| 更新   | 2026-10-15                                       |
| 何时读 | 加存储驱动、改上传取流 / 物理键 / 密钥加密时     |
| 规模   | ~2k token                                        |

## TL;DR

- 所有存储后端实现同一 `StorageDriver` 接口；上层只依赖该契约，**不得**出现供应商分支。
- 能力协商：云驱动用原生 multipart 与直链签名；本地驱动自实现「临时目录 + 合并」multipart，取流由服务端 `/api/raw/*` 代理。
- 物理键 = **unix 时间戳重命名**，与展示名解耦（改名不搬运）。
- 连接配置（AK/SK）AES-256-GCM 加密落库，列表只回掩码。

## 1. StorageDriver 接口

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
    uploadPart(key: string, uploadId: string, part: number, body): Promise<{ etag?: string }>;
    complete(key: string, uploadId: string, parts: MultipartPart[]): Promise<PutResult>;
    abort(key: string, uploadId: string): Promise<void>;
    listParts(key: string, uploadId: string): Promise<number[]>;
  };
  // 直传/签名
  signDownloadUrl(key: string, ttl: number, filename?: string): Promise<string | null>;
  signUploadUrl?(key: string, ttl: number): Promise<string | null>;
}
```

> 实现现状：`packages/storage/src/types.ts` 定义了等价接口（含 `supportsMultipart`、`readAll`）；`createStorageDriver()` 为工厂入口。
> 本地驱动的 `multipart.complete` 返回 `{ key, size, etag }`，其中 **`etag` 是完整 64 位 sha256**（顺序合并后计算），被 `upload.complete` 写入 `file_node.checksum` 并用于秒传判定——因此不能截断。

**能力协商**：本地驱动自己实现「临时目录 + 合并」版 multipart；COS/OSS/S3 直接用原生 multipart。无 `signDownloadUrl` 能力时，一律走服务端 `/api/raw/*` 代理流（本地驱动即如此）。

## 2. 本地存储约束

- 类型 `local` 的连接**全局唯一**（服务层硬校验，第二创建直接报错 `STORAGE_LOCAL_DUPLICATE`；DB 侧有 `connection_local_uidx`，见 `A2` §4）；
- 根目录固定为 `<项目根>/storage`，写入 `.gitignore`；
- 键名即相对路径，落盘前做**路径穿越防护**（`path.resolve` 后必须在 root 之内）。

## 3. 物理键生成（unix 时间戳重命名）

```
key = `${connectionId}/${yyyy}/${MM}/${Date.now()}-${rand8}${ext}`
例：c1a9.../2026/09/1757845200123-a3f9c2d1.png
```

原始文件名保存在 `file_node.name`，下载时通过 `Content-Disposition` 还原，用户无感。同目录重名由唯一索引 + 后缀策略处理（`(connection_id, COALESCE(parent_id), name)` 唯一索引，冲突时自动追加 ` (1)`），见 `A2` §5。

## 4. 连接配置加密

- `storage_connection.config_enc` 中的 `secretId/secretKey/accessKey` 用 **AES-256-GCM** 加密（密钥来自 `ENCRYPTION_KEY`），读取时解密；
- 列表接口**永不返回密钥原文**，只回掩码 `AKID****abcd`（存 `config_masked`）。
- 加密实现见 `packages/storage/src/crypto.ts`。

## 相关

- 决策：`D3`（二进制面走原生 HTTP）｜ 数据模型：`A2` §4 ｜ 上传流程：`A6` §2
- 安全总则：`A1` §7 ｜ 模块门面：`packages/storage/README.md`
