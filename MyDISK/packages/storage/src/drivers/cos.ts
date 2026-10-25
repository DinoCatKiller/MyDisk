import { Readable } from "node:stream";

import Cos from "cos-nodejs-sdk-v5";

import { StorageError } from "../errors";
import type {
  MultipartCapability,
  MultipartPart,
  PutOptions,
  PutResult,
  RangeOption,
  StorageBody,
  StorageDriver,
  StorageStat,
} from "../types";
import { applyPrefix, toBuffer } from "./util";

export type CosDriverOptions = {
  bucket: string;
  region?: string | null;
  secretId: string;
  secretKey: string;
  rootPrefix?: string | null;
};

type CosCallback<T> = (error: unknown, data: T) => void;

/** cos-nodejs-sdk-v5 是回调风格，统一 promisify */
function call<T>(fn: (cb: CosCallback<T>) => void): Promise<T> {
  return new Promise((resolvePromise, rejectPromise) => {
    fn((error, data) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      resolvePromise(data);
    });
  });
}

function isNotFound(error: unknown): boolean {
  const code = (error as { statusCode?: number; code?: string }) ?? {};
  return code.statusCode === 404 || code.code === "NoSuchKey";
}

/**
 * 腾讯云 COS 驱动（cos-nodejs-sdk-v5）。
 * 原生 multipart 直连 COS 分片接口；下载直链用 SDK 的 getObjectUrl 预签名。
 */
export class CosDriver implements StorageDriver {
  readonly type = "cos" as const;
  readonly supportsMultipart = true;
  readonly multipart: MultipartCapability;

  private readonly client: Cos;
  private readonly bucket: string;
  private readonly region: string;
  private readonly prefix: string;

  constructor(options: CosDriverOptions) {
    if (!options.bucket || !options.region) {
      throw new StorageError("UNKNOWN", "COS 连接缺少 bucket / region");
    }
    this.bucket = options.bucket;
    this.region = options.region;
    this.prefix = (options.rootPrefix ?? "").replace(/^\/+|\/+$/g, "");
    this.client = new Cos({
      SecretId: options.secretId,
      SecretKey: options.secretKey,
    });
    this.multipart = {
      init: (key, opts) => this.multipartInit(key, opts),
      uploadPart: (key, uploadId, partNumber, body) =>
        this.multipartUploadPart(key, uploadId, partNumber, body),
      complete: (key, uploadId, parts) => this.multipartComplete(key, uploadId, parts),
      abort: (key, uploadId) => this.multipartAbort(key, uploadId),
      listParts: (key, uploadId) => this.multipartListParts(key, uploadId),
    };
  }

  private objectName(key: string): string {
    return applyPrefix(this.prefix, key);
  }

  private wrapNotFound(error: unknown, key: string): never {
    if (isNotFound(error)) {
      throw new StorageError("NOT_FOUND", `文件不存在: ${key}`);
    }
    throw error;
  }

  async put(key: string, body: StorageBody, options?: PutOptions): Promise<PutResult> {
    const buffer = await toBuffer(body);
    await call((cb) =>
      this.client.putObject(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: this.objectName(key),
          Body: buffer,
          ContentType: options?.contentType,
        },
        cb,
      ),
    );
    return { key, size: buffer.length };
  }

  async get(key: string, range?: RangeOption): Promise<ReadableStream<Uint8Array>> {
    try {
      // DataType: "stream" 让 SDK 返回流式 Body（SDK 类型未覆盖该参数，此处收窄）
      const output = await call<{ Body?: Buffer | { pipeline: () => NodeJS.ReadableStream } }>(
        (cb) =>
          this.client.getObject(
            {
              Bucket: this.bucket,
              Region: this.region,
              Key: this.objectName(key),
              Range: range ? `bytes=${range.start}-${range.end ?? ""}` : undefined,
              DataType: "stream",
            } as never,
            cb as never,
          ),
      );
      const body = output.Body;
      const nodeStream =
        body && typeof body === "object" && "pipeline" in body
          ? body.pipeline()
          : body
            ? Readable.from(body)
            : undefined;
      if (!nodeStream) {
        throw new StorageError("NOT_FOUND", `文件不存在: ${key}`);
      }
      return Readable.toWeb(nodeStream as never) as ReadableStream<Uint8Array>;
    } catch (error) {
      if (isNotFound(error)) {
        this.wrapNotFound(error, key);
      }
      throw error;
    }
  }

  async head(key: string): Promise<StorageStat | null> {
    try {
      const output = await call<{ headers?: Record<string, string | undefined> }>((cb) =>
        this.client.headObject(
          { Bucket: this.bucket, Region: this.region, Key: this.objectName(key) },
          cb as never,
        ),
      );
      const headers = output.headers ?? {};
      return {
        key,
        size: Number(headers["content-length"] ?? 0),
        lastModified: headers["last-modified"]
          ? new Date(String(headers["last-modified"]))
          : undefined,
        etag: headers.etag,
      };
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await call((cb) =>
      this.client.deleteObject(
        { Bucket: this.bucket, Region: this.region, Key: this.objectName(key) },
        cb,
      ),
    );
  }

  async deleteMany(keys: string[]): Promise<void> {
    // COS 单次批量删除上限 1000
    for (let start = 0; start < keys.length; start += 1000) {
      const batch = keys.slice(start, start + 1000);
      if (batch.length === 0) {
        continue;
      }
      await call((cb) =>
        this.client.deleteMultipleObject(
          {
            Bucket: this.bucket,
            Region: this.region,
            Objects: batch.map((key) => ({ Key: this.objectName(key) })),
          },
          cb,
        ),
      );
    }
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    await call((cb) =>
      this.client.putObjectCopy(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: this.objectName(toKey),
          CopySource: `${this.bucket}.cos.${this.region}.myqcloud.com/${encodeURIComponent(this.objectName(fromKey))}`,
        },
        cb,
      ),
    );
  }

  async list(prefix: string): Promise<StorageStat[]> {
    const output = await call<{ Contents?: { Key: string; Size: number; LastModified: string }[] }>(
      (cb) =>
        this.client.getBucket(
          {
            Bucket: this.bucket,
            Region: this.region,
            Prefix: this.objectName(prefix),
            Delimiter: "/",
            MaxKeys: 1000,
          },
          cb as never,
        ),
    );
    const base = this.prefix ? `${this.prefix}/` : "";
    return (output.Contents ?? []).map((object) => ({
      key: object.Key.startsWith(base) ? object.Key.slice(base.length) : object.Key,
      size: object.Size,
      lastModified: object.LastModified ? new Date(object.LastModified) : undefined,
    }));
  }

  async readAll(key: string): Promise<Uint8Array> {
    return toBuffer(await this.get(key));
  }

  async signDownloadUrl(
    key: string,
    ttlSeconds: number,
    filename?: string,
  ): Promise<string | null> {
    const url = await call<string>((cb) =>
      this.client.getObjectUrl(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: this.objectName(key),
          Sign: true,
          Expires: ttlSeconds,
          Query: {},
          Headers: filename
            ? {
                "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
              }
            : undefined,
        },
        (error, data) => cb(error, data?.Url),
      ),
    );
    return url;
  }

  private async multipartInit(key: string, options?: PutOptions): Promise<string> {
    const output = await call<{ UploadId: string }>((cb) =>
      this.client.multipartInit(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: this.objectName(key),
          ContentType: options?.contentType,
        },
        cb,
      ),
    );
    if (!output.UploadId) {
      throw new StorageError("UPLOAD_SESSION_INVALID", "创建分片会话失败");
    }
    return output.UploadId;
  }

  private async multipartUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: StorageBody,
  ): Promise<{ etag?: string }> {
    const buffer = await toBuffer(body);
    const output = await call<{ headers?: Record<string, string | undefined> }>((cb) =>
      this.client.multipartUpload(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: this.objectName(key),
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: buffer,
          ContentLength: buffer.length,
        } as never,
        cb as never,
      ),
    );
    return { etag: output.headers?.etag };
  }

  private async multipartComplete(
    key: string,
    uploadId: string,
    parts: MultipartPart[],
  ): Promise<PutResult> {
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    await call((cb) =>
      this.client.multipartComplete(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: this.objectName(key),
          UploadId: uploadId,
          Parts: ordered.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag ?? "" })),
        },
        cb,
      ),
    );
    const stat = await this.head(key);
    return { key, size: stat?.size ?? 0 };
  }

  private async multipartAbort(key: string, uploadId: string): Promise<void> {
    await call((cb) =>
      this.client.multipartAbort(
        { Bucket: this.bucket, Region: this.region, Key: this.objectName(key), UploadId: uploadId },
        cb,
      ),
    );
  }

  private async multipartListParts(key: string, uploadId: string): Promise<number[]> {
    const numbers: number[] = [];
    // COS 的 marker / IsTruncated 均为字符串语义（与 S3 的 number 不同）
    let marker: string | undefined;
    for (;;) {
      const output = await call<{
        Parts?: { PartNumber: number }[];
        IsTruncated?: string;
        NextPartNumberMarker?: string;
      }>((cb) =>
        this.client.multipartListPart(
          {
            Bucket: this.bucket,
            Region: this.region,
            Key: this.objectName(key),
            UploadId: uploadId,
            PartNumberMarker: marker,
          } as never,
          cb as never,
        ),
      );
      for (const part of output.Parts ?? []) {
        numbers.push(part.PartNumber);
      }
      if (output.IsTruncated !== "true" || output.NextPartNumberMarker === undefined) {
        break;
      }
      marker = output.NextPartNumberMarker;
    }
    return numbers.sort((a, b) => a - b);
  }
}
