import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";

export type ZipEntry = {
  name: string;
  isDirectory: boolean;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

/** 读取中央目录（需先取文件尾部 EOCD，标准 zip；zip64 明确报错） */
export async function readZipEntries(filePath: string): Promise<ZipEntry[]> {
  const info = await fs.stat(filePath);
  if (info.size < 22) {
    throw new Error("不是有效的 zip 文件");
  }
  const tailLength = Math.min(info.size, 22 + 0xffff);
  const handle = await fs.open(filePath, "r");
  try {
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, info.size - tailLength);
    let eocd = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === 0x06054b50) {
        eocd = index;
        break;
      }
    }
    if (eocd < 0) {
      throw new Error("不是有效的 zip 文件（缺少中央目录）");
    }
    const totalEntries = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (totalEntries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
      throw new Error("暂不支持 zip64 压缩包（超过 4GB 或 65535 个条目）");
    }

    const central = Buffer.alloc(centralSize);
    if (centralSize > 0) {
      await handle.read(central, 0, centralSize, centralOffset);
    }

    const entries: ZipEntry[] = [];
    let cursor = 0;
    for (let index = 0; index < totalEntries; index += 1) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== 0x02014b50) {
        throw new Error("zip 中央目录损坏");
      }
      const flags = central.readUInt16LE(cursor + 8);
      const method = central.readUInt16LE(cursor + 10);
      const compressedSize = central.readUInt32LE(cursor + 20);
      const uncompressedSize = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28);
      const extraLength = central.readUInt16LE(cursor + 30);
      const commentLength = central.readUInt16LE(cursor + 32);
      const localHeaderOffset = central.readUInt32LE(cursor + 42);
      const name = central
        .subarray(cursor + 46, cursor + 46 + nameLength)
        .toString(flags & 0x0800 ? "utf8" : "latin1");

      entries.push({
        name,
        isDirectory: name.endsWith("/") || name.endsWith("\\"),
        method,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  } finally {
    await handle.close();
  }
}

/** 打开单个条目的解压流（调用方需按顺序消费，避免同时打开过多文件句柄） */
export async function openZipEntry(
  filePath: string,
  entry: ZipEntry,
): Promise<ReadableStream<Uint8Array>> {
  const handle = await fs.open(filePath, "r");
  let start = 0;
  try {
    const header = Buffer.alloc(30);
    await handle.read(header, 0, 30, entry.localHeaderOffset);
    if (header.readUInt32LE(0) !== 0x04034b50) {
      throw new Error("zip 条目头损坏");
    }
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    start = entry.localHeaderOffset + 30 + nameLength + extraLength;
  } finally {
    await handle.close();
  }

  let stream: Readable =
    entry.compressedSize > 0
      ? createReadStream(filePath, { start, end: start + entry.compressedSize - 1 })
      : Readable.from([]);

  if (entry.method === 8) {
    stream = stream.pipe(createInflateRaw());
  } else if (entry.method !== 0) {
    throw new Error(`不支持的 zip 压缩方式: ${entry.method}`);
  }
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}
