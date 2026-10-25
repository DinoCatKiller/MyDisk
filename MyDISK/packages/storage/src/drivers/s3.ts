import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

export type S3DriverOptions = {
  bucket: string;
  region?: string | null;
  endpoint?: string | null;
  accessKeyId: string;
  secretAccessKey: string;
  rootPrefix?: string | null;
};

function fileNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name ?? "";
  return name === "NotFound" || name === "NoSuchKey" || name === "404";
}

/**
 * S3 兼容驱动：AWS S3 / MinIO / 各类 S3 兼容网关。
 * 自定义 endpoint 时启用 path-style 寻址（MinIO / 私有部署的标准形态）。
 */
export class S3Driver implements StorageDriver {
  readonly type = "s3" as const;
  readonly supportsMultipart = true;
  readonly multipart: MultipartCapability;

  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor(options: S3DriverOptions) {
    if (!options.bucket) {
      throw new StorageError("UNKNOWN", "S3 连接缺少 bucket");
    }
    this.bucket = options.bucket;
    this.prefix = (options.rootPrefix ?? "").replace(/^\/+|\/+$/g, "");
    this.client = new S3Client({
      region: options.region || "us-east-1",
      endpoint: options.endpoint || undefined,
      forcePathStyle: Boolean(options.endpoint),
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
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

  async put(key: string, body: StorageBody, options?: PutOptions): Promise<PutResult> {
    const buffer = await toBuffer(body);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.objectName(key),
      Body: buffer,
      ContentType: options?.contentType,
      ContentLength: buffer.length,
    });
    const output = await this.client.send(command);
    return { key, size: buffer.length, etag: output.ETag };
  }

  async get(key: string, range?: RangeOption): Promise<ReadableStream<Uint8Array>> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.objectName(key),
      Range: range ? `bytes=${range.start}-${range.end ?? ""}` : undefined,
    });
    try {
      const output = await this.client.send(command);
      if (!output.Body) {
        throw new StorageError("NOT_FOUND", `文件不存在: ${key}`);
      }
      return output.Body.transformToWebStream() as ReadableStream<Uint8Array>;
    } catch (error) {
      if (fileNotFound(error)) {
        throw new StorageError("NOT_FOUND", `文件不存在: ${key}`);
      }
      throw error;
    }
  }

  async head(key: string): Promise<StorageStat | null> {
    try {
      const output = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectName(key) }),
      );
      return {
        key,
        size: output.ContentLength ?? 0,
        lastModified: output.LastModified,
        etag: output.ETag,
      };
    } catch (error) {
      if (fileNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectName(key) }),
    );
  }

  /** S3 批量删除单次上限 1000 个 key */
  async deleteMany(keys: string[]): Promise<void> {
    for (let start = 0; start < keys.length; start += 1000) {
      const batch = keys.slice(start, start + 1000);
      if (batch.length === 0) {
        continue;
      }
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: batch.map((key) => ({ Key: this.objectName(key) })),
            Quiet: true,
          },
        }),
      );
    }
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `/${this.bucket}/${this.objectName(fromKey)}`,
        Key: this.objectName(toKey),
      }),
    );
  }

  async list(prefix: string): Promise<StorageStat[]> {
    const output = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: this.objectName(prefix),
        Delimiter: "/",
        MaxKeys: 1000,
      }),
    );
    const base = this.prefix ? `${this.prefix}/` : "";
    return (output.Contents ?? []).map((object) => ({
      key: (object.Key ?? "").startsWith(base)
        ? (object.Key ?? "").slice(base.length)
        : (object.Key ?? ""),
      size: object.Size ?? 0,
      lastModified: object.LastModified,
      etag: object.ETag,
    }));
  }

  async readAll(key: string): Promise<Uint8Array> {
    const buffer = await toBuffer(await this.get(key));
    return buffer;
  }

  async signDownloadUrl(
    key: string,
    ttlSeconds: number,
    filename?: string,
  ): Promise<string | null> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.objectName(key),
      ResponseContentDisposition: filename
        ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
        : undefined,
    });
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  private async multipartInit(key: string, options?: PutOptions): Promise<string> {
    const output = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.objectName(key),
        ContentType: options?.contentType,
      }),
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
    const output = await this.client.send(
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: this.objectName(key),
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: buffer,
        ContentLength: buffer.length,
      }),
    );
    return { etag: output.ETag };
  }

  private async multipartComplete(
    key: string,
    uploadId: string,
    parts: MultipartPart[],
  ): Promise<PutResult> {
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    // S3 协议：分片号 1 起且必须带各自的 ETag
    const output = await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.objectName(key),
        UploadId: uploadId,
        MultipartUpload: {
          Parts: ordered.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
        },
      }),
    );
    return {
      key,
      size: output.Key ? await this.head(key).then((stat) => stat?.size ?? 0) : 0,
      etag: output.ETag,
    };
  }

  private async multipartAbort(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.objectName(key),
        UploadId: uploadId,
      }),
    );
  }

  private async multipartListParts(key: string, uploadId: string): Promise<number[]> {
    const numbers: number[] = [];
    let marker: string | undefined;
    for (;;) {
      const output = await this.client.send(
        new ListPartsCommand({
          Bucket: this.bucket,
          Key: this.objectName(key),
          UploadId: uploadId,
          PartNumberMarker: marker,
        }),
      );
      for (const part of output.Parts ?? []) {
        if (part.PartNumber) {
          numbers.push(part.PartNumber);
        }
      }
      if (!output.IsTruncated || output.NextPartNumberMarker === undefined) {
        break;
      }
      marker = output.NextPartNumberMarker;
    }
    return numbers.sort((a, b) => a - b);
  }
}
