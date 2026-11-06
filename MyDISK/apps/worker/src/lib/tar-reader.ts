import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

/** 顺序读取流，支持「读固定长度」和「只读 N 字节」两种模式 */
class ByteReader {
  private readonly iterator: AsyncIterator<Buffer>;
  private buffered = Buffer.alloc(0);

  constructor(stream: Readable) {
    this.iterator = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  }

  private async fill(): Promise<boolean> {
    const next = await this.iterator.next();
    if (next.done) {
      return false;
    }
    this.buffered = this.buffered.length
      ? Buffer.concat([this.buffered, next.value])
      : Buffer.from(next.value);
    return true;
  }

  async readExactly(length: number): Promise<Buffer> {
    while (this.buffered.length < length) {
      if (!(await this.fill())) {
        throw new Error("tar 数据不完整");
      }
    }
    const chunk = this.buffered.subarray(0, length);
    this.buffered = this.buffered.subarray(length);
    return chunk;
  }

  async *stream(length: number): AsyncGenerator<Buffer> {
    let remaining = length;
    while (remaining > 0) {
      if (this.buffered.length === 0 && !(await this.fill())) {
        throw new Error("tar 数据不完整");
      }
      const take = Math.min(remaining, this.buffered.length);
      const chunk = this.buffered.subarray(0, take);
      this.buffered = this.buffered.subarray(take);
      remaining -= take;
      yield chunk;
    }
  }

  async skip(length: number): Promise<void> {
    for await (const _chunk of this.stream(length)) {
      // 丢弃
    }
  }
}

export type TarEntry = {
  name: string;
  isDirectory: boolean;
  size: number;
  data: AsyncIterable<Buffer>;
};

function pad512(size: number): number {
  return (512 - (size % 512)) % 512;
}

function parseOctal(buffer: Buffer, start: number, length: number): number {
  const text = buffer
    .subarray(start, start + length)
    .toString("utf8")
    .replace(/\0.*$/s, "")
    .trim();
  if (!text) {
    return 0;
  }
  const value = Number.parseInt(text, 8);
  return Number.isFinite(value) ? value : 0;
}

function headerName(header: Buffer): string {
  const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
  const magic = header.subarray(257, 263).toString("utf8");
  if (magic !== "ustar") {
    return name;
  }
  const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
  return prefix ? `${prefix}/${name}` : name;
}

function parsePaxPath(data: Buffer): string | null {
  const lines = data.toString("utf8").split("\n");
  for (const line of lines) {
    const space = line.indexOf(" ");
    if (space <= 0) {
      continue;
    }
    const record = line.slice(space + 1);
    if (record.startsWith("path=")) {
      return record.slice(5);
    }
  }
  return null;
}

async function* emptyData(): AsyncGenerator<Buffer> {
  // 空迭代器
}

/**
 * 顺序解析 .tar.gz：只支持普通文件、目录、GNU longname / pax path。
 * 调用方必须完整消费 `entry.data`，否则流位置会错位。
 */
export async function* readTarGzEntries(filePath: string): AsyncGenerator<TarEntry> {
  const reader = new ByteReader(createReadStream(filePath).pipe(createGunzip()));
  let pendingName: string | null = null;

  while (true) {
    let header: Buffer;
    try {
      header = await reader.readExactly(512);
    } catch {
      break; // 正常结束（gunzip 流耗尽）
    }
    if (header.every((byte) => byte === 0)) {
      break;
    }

    const type = String.fromCharCode(header[156] ?? 0);
    const size = parseOctal(header, 124, 12);
    const rawName = headerName(header);

    if (type === "L") {
      const data = await reader.readExactly(size);
      pendingName = data.toString("utf8").replace(/\0.*$/s, "");
      await reader.skip(pad512(size));
      continue;
    }
    if (type === "x") {
      const data = await reader.readExactly(size);
      const paxPath = parsePaxPath(data);
      if (paxPath) {
        pendingName = paxPath;
      }
      await reader.skip(pad512(size));
      continue;
    }
    if (type === "g") {
      await reader.skip(size + pad512(size));
      continue;
    }

    const name = pendingName ?? rawName;
    pendingName = null;
    const isDirectory = type === "5" || name.endsWith("/");

    if (type === "0" || type === "\0" || type === "" || isDirectory) {
      const isDir = isDirectory;
      yield {
        name,
        isDirectory: isDir,
        size: isDir ? 0 : size,
        data: isDir ? emptyData() : reader.stream(size),
      };
      if (isDir) {
        await reader.skip(size + pad512(size));
      } else {
        await reader.skip(pad512(size));
      }
      continue;
    }

    // 符号链接 / 设备等条目直接丢弃
    await reader.skip(size + pad512(size));
  }
}
