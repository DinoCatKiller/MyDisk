import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

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

export type LocalDriverOptions = {
  /** 存储根目录（绝对路径） */
  root: string;
  connectionId: string;
  rootPrefix?: string | null;
};

function toNodeReadable(body: StorageBody): Readable {
  if (body instanceof Uint8Array) {
    return Readable.from([body]);
  }
  if (body instanceof ArrayBuffer) {
    return Readable.from([new Uint8Array(body)]);
  }
  const maybeStream = body as ReadableStream<Uint8Array>;
  if (typeof maybeStream.getReader === "function") {
    return Readable.fromWeb(maybeStream as Parameters<typeof Readable.fromWeb>[0]);
  }
  return body as unknown as Readable;
}

/**
 * 本地文件系统驱动。
 * 分片上传以「<root>/.tmp/<uploadId>/<partNumber>」暂存，complete 时顺序合并。
 */
export class LocalStorageDriver implements StorageDriver {
  readonly type = "local" as const;
  readonly supportsMultipart = true;
  readonly multipart: MultipartCapability;

  private readonly root: string;
  private readonly connectionId: string;
  private readonly rootPrefix: string;

  constructor(options: LocalDriverOptions) {
    this.root = resolve(options.root);
    this.connectionId = options.connectionId;
    this.rootPrefix = (options.rootPrefix ?? "").replace(/^\/+|\/+$/g, "");
    this.multipart = {
      init: (key, opts) => this.multipartInit(key, opts),
      uploadPart: (key, uploadId, partNumber, body) =>
        this.multipartUploadPart(key, uploadId, partNumber, body),
      complete: (key, uploadId, parts) => this.multipartComplete(key, uploadId, parts),
      abort: (key, uploadId) => this.multipartAbort(key, uploadId),
      listParts: (key, uploadId) => this.multipartListParts(key, uploadId),
    };
  }

  private resolve(key: string): string {
    const full = resolve(this.root, this.rootPrefix, key);
    const rootWithSep = this.root.endsWith(sep) ? this.root : `${this.root}${sep}`;
    if (full !== this.root && !full.startsWith(rootWithSep)) {
      throw new StorageError("PATH_TRAVERSAL", `非法存储键: ${key}`);
    }
    return full;
  }

  /** 分片暂存目录按连接隔离，避免多连接互相干扰 */
  private tempDir(uploadId: string): string {
    return this.resolve(join(".tmp", this.connectionId, uploadId));
  }

  private partName(partNumber: number): string {
    return `${`${partNumber}`.padStart(8, "0")}.part`;
  }

  async put(key: string, body: StorageBody, options?: PutOptions): Promise<PutResult> {
    // 本地文件系统不支持自定义 Content-Type，由 file_node.mime 记录
    void options;
    const target = this.resolve(key);
    await mkdir(dirname(target), { recursive: true });
    await pipeline(toNodeReadable(body), createWriteStream(target));
    const info = await stat(target);
    return { key, size: info.size };
  }

  async get(key: string, range?: RangeOption): Promise<ReadableStream<Uint8Array>> {
    const target = this.resolve(key);
    try {
      await stat(target);
    } catch {
      throw new StorageError("NOT_FOUND", `文件不存在: ${key}`);
    }
    const stream = range
      ? createReadStream(target, { start: range.start, end: range.end })
      : createReadStream(target);
    return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
  }

  async head(key: string): Promise<StorageStat | null> {
    try {
      const info = await stat(this.resolve(key));
      if (!info.isFile()) {
        return null;
      }
      return { key, size: info.size, lastModified: info.mtime };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolve(key));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }

  async deleteMany(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.delete(key);
    }
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    const target = this.resolve(toKey);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(this.resolve(fromKey), target);
  }

  async list(prefix: string): Promise<StorageStat[]> {
    const dir = this.resolve(prefix || ".");
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const result: StorageStat[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const key = prefix ? `${prefix.replace(/\/+$/, "")}/${entry.name}` : entry.name;
      const info = await stat(join(dir, entry.name));
      result.push({ key, size: info.size, lastModified: info.mtime });
    }
    return result;
  }

  async readAll(key: string): Promise<Uint8Array> {
    return readFile(this.resolve(key));
  }

  async signDownloadUrl(): Promise<string | null> {
    // 本地存储一律由服务端代理流式输出
    return null;
  }

  private async multipartInit(key: string, options?: PutOptions): Promise<string> {
    void options;
    const uploadId = randomUUID();
    const dir = this.tempDir(uploadId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "target.key"), key, "utf8");
    return uploadId;
  }

  private async multipartUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: StorageBody,
  ): Promise<{ etag?: string }> {
    void key;
    const dir = this.tempDir(uploadId);
    await mkdir(dir, { recursive: true });
    const partPath = join(dir, this.partName(partNumber));
    const hash = createHash("sha256");
    const source = toNodeReadable(body);
    source.on("data", (chunk: Buffer | Uint8Array) => hash.update(chunk));
    await pipeline(source, createWriteStream(partPath));
    return { etag: hash.digest("hex").slice(0, 16) };
  }

  private async multipartComplete(
    key: string,
    uploadId: string,
    parts: MultipartPart[],
  ): Promise<PutResult> {
    const dir = this.tempDir(uploadId);
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
    if (ordered.length === 0) {
      throw new StorageError("UPLOAD_SESSION_INVALID", "没有可合并的分片");
    }
    const target = this.resolve(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, new Uint8Array(0));
    const hash = createHash("sha256");
    for (const part of ordered) {
      const buffer = await readFile(join(dir, this.partName(part.partNumber)));
      hash.update(buffer);
      await appendFile(target, buffer);
    }
    const info = await stat(target);
    await rm(dir, { recursive: true, force: true });
    // 合并结果返回完整 sha256（64 hex），供 file_node.checksum 与秒传判定使用
    return { key, size: info.size, etag: hash.digest("hex") };
  }

  private async multipartAbort(key: string, uploadId: string): Promise<void> {
    void key;
    await rm(this.tempDir(uploadId), { recursive: true, force: true });
  }

  private async multipartListParts(key: string, uploadId: string): Promise<number[]> {
    void key;
    try {
      const entries = await readdir(this.tempDir(uploadId));
      return entries
        .filter((name) => name.endsWith(".part"))
        .map((name) => Number.parseInt(name.replace(".part", ""), 10))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }
}
