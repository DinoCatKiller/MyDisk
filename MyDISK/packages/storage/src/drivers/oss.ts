import OSS from "ali-oss";

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

export type OssDriverOptions = {
  bucket: string;
  region?: string | null;
  endpoint?: string | null;
  accessKeyId: string;
  accessKeySecret: string;
  rootPrefix?: string | null;
};

function isNotFound(error: unknown): boolean {
  const code = (error as { code?: string; status?: number }) ?? {};
  return code.code === "NoSuchKey" || code.status === 404;
}

/**
 * 阿里云 OSS 驱动（ali-oss）。
 * 读取统一走 signatureUrl + fetch：Range 取流与签名直链共用一条已验证的路径，
 * 避开 ali-oss 对 Node 流 Range 语义的差异。
 */
export class OssDriver implements StorageDriver {
  readonly type = "oss" as const;
  readonly supportsMultipart = true;
  readonly multipart: MultipartCapability;

  private readonly client: OSS;
  private readonly prefix: string;

  constructor(options: OssDriverOptions) {
    if (!options.bucket || !options.region) {
      throw new StorageError("UNKNOWN", "OSS 连接缺少 bucket / region");
    }
    this.prefix = (options.rootPrefix ?? "").replace(/^\/+|\/+$/g, "");
    this.client = new OSS({
      accessKeyId: options.accessKeyId,
      accessKeySecret: options.accessKeySecret,
      bucket: options.bucket,
      region: options.region,
      endpoint: options.endpoint || undefined,
      secure: !options.endpoint?.startsWith("http://"),
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
    try {
      const output = await this.client.put(this.objectName(key), buffer, {
        mime: options?.contentType,
      });
      return { key, size: buffer.length, etag: (output as { etag?: string }).etag };
    } catch (error) {
      this.wrapNotFound(error, key);
    }
  }

  async get(key: string, range?: RangeOption): Promise<ReadableStream<Uint8Array>> {
    const rangeHeader = range ? `bytes=${range.start}-${range.end ?? ""}` : undefined;
    try {
      const signed = this.client.signatureUrl(this.objectName(key), { expires: 300 });
      const response = await fetch(signed, {
        headers: rangeHeader ? { Range: rangeHeader } : undefined,
      });
      if (response.status === 404) {
        throw new StorageError("NOT_FOUND", `文件不存在: ${key}`);
      }
      if (!response.ok || !response.body) {
        throw new StorageError("UNKNOWN", `OSS 读取失败（HTTP ${response.status}）`);
      }
      return response.body;
    } catch (error) {
      if (isNotFound(error)) {
        this.wrapNotFound(error, key);
      }
      throw error;
    }
  }

  async head(key: string): Promise<StorageStat | null> {
    try {
      const output = await this.client.head(this.objectName(key));
      const meta = (output.res?.headers ?? {}) as Record<string, string | undefined>;
      return {
        key,
        size: Number(meta["content-length"] ?? 0),
        lastModified: meta["last-modified"] ? new Date(meta["last-modified"]) : undefined,
        etag: meta.etag,
      };
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.delete(this.objectName(key));
  }

  async deleteMany(keys: string[]): Promise<void> {
    // OSS deleteMulti 单次上限 1000
    for (let start = 0; start < keys.length; start += 1000) {
      const batch = keys.slice(start, start + 1000).map((key) => this.objectName(key));
      if (batch.length === 0) {
        continue;
      }
      await this.client.deleteMulti(batch, { quiet: true });
    }
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    await this.client.copy(this.objectName(toKey), this.objectName(fromKey));
  }

  async list(prefix: string): Promise<StorageStat[]> {
    const output = await this.client.listV2(
      { prefix: this.objectName(prefix), "max-keys": 1000, delimiter: "/" },
      {},
    );
    const base = this.prefix ? `${this.prefix}/` : "";
    type OssObject = { name: string; size: number; lastModified: string };
    return ((output as { objects?: OssObject[] }).objects ?? []).map((object) => ({
      key: object.name.startsWith(base) ? object.name.slice(base.length) : object.name,
      size: object.size,
      lastModified: object.lastModified ? new Date(object.lastModified) : undefined,
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
    return this.client.signatureUrl(this.objectName(key), {
      expires: ttlSeconds,
      response: filename
        ? {
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          }
        : undefined,
    });
  }

  private async multipartInit(key: string, options?: PutOptions): Promise<string> {
    const output = await this.client.initMultipartUpload(this.objectName(key), {
      mime: options?.contentType,
    });
    if (!output.uploadId) {
      throw new StorageError("UPLOAD_SESSION_INVALID", "创建分片会话失败");
    }
    return output.uploadId;
  }

  private async multipartUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: StorageBody,
  ): Promise<{ etag?: string }> {
    const buffer = await toBuffer(body);
    const output = await this.client.uploadPart(
      this.objectName(key),
      uploadId,
      partNumber,
      buffer,
      0,
      buffer.length - 1,
    );
    return { etag: output.etag };
  }

  private async multipartComplete(
    key: string,
    uploadId: string,
    parts: MultipartPart[],
  ): Promise<PutResult> {
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    await this.client.completeMultipartUpload(
      this.objectName(key),
      uploadId,
      ordered.map((part) => ({ number: part.partNumber, etag: part.etag ?? "" })),
    );
    const stat = await this.head(key);
    return { key, size: stat?.size ?? 0 };
  }

  private async multipartAbort(key: string, uploadId: string): Promise<void> {
    await this.client.abortMultipartUpload(this.objectName(key), uploadId);
  }

  private async multipartListParts(key: string, uploadId: string): Promise<number[]> {
    const numbers: number[] = [];
    let marker = 0;
    for (;;) {
      const output = await this.client.listParts(this.objectName(key), uploadId, {
        "max-parts": 1000,
        "part-number-marker": marker,
        "encoding-type": "url",
      });
      for (const part of output.parts ?? []) {
        numbers.push(part.PartNumber);
      }
      if (!output.isTruncated || output.nextPartNumberMarker === undefined) {
        break;
      }
      marker = output.nextPartNumberMarker;
    }
    return numbers.sort((a, b) => a - b);
  }
}
