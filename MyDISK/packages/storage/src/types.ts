/** 与 db 的 storage_type 枚举保持一致 */
export type StorageDriverType = "local" | "cos" | "oss" | "s3";

export type StorageBody = ReadableStream<Uint8Array> | Uint8Array | ArrayBuffer | Buffer;

export type PutOptions = {
  contentType?: string;
  contentLength?: number;
};

export type PutResult = {
  key: string;
  size: number;
  etag?: string;
};

export type StorageStat = {
  key: string;
  size: number;
  lastModified?: Date;
  etag?: string;
};

export type RangeOption = {
  start: number;
  /** 含端点，未提供表示到结尾 */
  end?: number;
};

export type MultipartPart = {
  partNumber: number;
  etag?: string;
  size?: number;
};

/**
 * 分片上传能力。
 * 本地驱动用「临时目录 + 合并」实现，云驱动用原生 multipart。
 */
export interface MultipartCapability {
  init(key: string, options?: PutOptions): Promise<string>;
  uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: StorageBody,
  ): Promise<{ etag?: string }>;
  complete(key: string, uploadId: string, parts: MultipartPart[]): Promise<PutResult>;
  abort(key: string, uploadId: string): Promise<void>;
  /** 返回已完成的分片号，用于断点续传 */
  listParts(key: string, uploadId: string): Promise<number[]>;
}

export interface StorageDriver {
  readonly type: StorageDriverType;
  /** 是否具备原生分片能力 */
  readonly supportsMultipart: boolean;

  put(key: string, body: StorageBody, options?: PutOptions): Promise<PutResult>;
  get(key: string, range?: RangeOption): Promise<ReadableStream<Uint8Array>>;
  head(key: string): Promise<StorageStat | null>;
  delete(key: string): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;
  copy(fromKey: string, toKey: string): Promise<void>;
  /** 非递归列举，本地驱动需要读取实际目录时才用得上 */
  list(prefix: string): Promise<StorageStat[]>;
  readAll(key: string): Promise<Uint8Array>;
  /** 云存储可返回直链；本地驱动返回 null，由服务端代理流 */
  signDownloadUrl(key: string, ttlSeconds: number, filename?: string): Promise<string | null>;

  multipart?: MultipartCapability;
}

export type StorageConnectionLike = {
  id: string;
  type: StorageDriverType;
  bucket?: string | null;
  region?: string | null;
  endpoint?: string | null;
  rootPrefix?: string | null;
  config?: Record<string, unknown> | null;
};
