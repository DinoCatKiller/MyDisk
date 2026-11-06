import { Readable } from "node:stream";
import { createDeflateRaw } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

/** 增量 CRC32（传入上一次结果即可链式计算） */
export function crc32(data: Uint8Array, previous = 0): number {
  let crc = previous ^ 0xffffffff;
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export type ZipSource = {
  /** zip 内相对路径，目录以 `/` 结尾 */
  name: string;
  isDirectory: boolean;
  /** 仅在文件条目被调用 */
  open: () => Promise<ReadableStream<Uint8Array>>;
};

const FLAG_UTF8 = 0x0800;
const FLAG_DATA_DESCRIPTOR = 0x0008;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function localHeader(options: {
  name: Buffer;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  stamp: { time: number; date: number };
}): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(options.flags, 6);
  header.writeUInt16LE(options.method, 8);
  header.writeUInt16LE(options.stamp.time, 10);
  header.writeUInt16LE(options.stamp.date, 12);
  header.writeUInt32LE(options.crc, 14);
  header.writeUInt32LE(options.compressedSize, 18);
  header.writeUInt32LE(options.uncompressedSize, 22);
  header.writeUInt16LE(options.name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, options.name]);
}

function centralHeader(record: {
  name: Buffer;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
  isDirectory: boolean;
  stamp: { time: number; date: number };
}): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(record.flags, 8);
  header.writeUInt16LE(record.method, 10);
  header.writeUInt16LE(record.stamp.time, 12);
  header.writeUInt16LE(record.stamp.date, 14);
  header.writeUInt32LE(record.crc, 16);
  header.writeUInt32LE(record.compressedSize, 20);
  header.writeUInt32LE(record.uncompressedSize, 24);
  header.writeUInt16LE(record.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(record.isDirectory ? 0x10 : 0, 38);
  header.writeUInt32LE(record.offset, 42);
  return Buffer.concat([header, record.name]);
}

function dataDescriptor(crc: number, compressedSize: number, uncompressedSize: number): Buffer {
  const buffer = Buffer.alloc(16);
  buffer.writeUInt32LE(0x08074b50, 0);
  buffer.writeUInt32LE(crc, 4);
  buffer.writeUInt32LE(compressedSize, 8);
  buffer.writeUInt32LE(uncompressedSize, 12);
  return buffer;
}

type CentralRecord = {
  name: Buffer;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  offset: number;
  isDirectory: boolean;
  stamp: { time: number; date: number };
};

async function* zipIterator(sources: ZipSource[]): AsyncGenerator<Buffer> {
  if (sources.length > 0xffff) {
    throw new Error("压缩包条目超过 65535 个，暂不支持");
  }
  const stamp = dosDateTime(new Date());
  const central: CentralRecord[] = [];
  let offset = 0;

  for (const source of sources) {
    const name = Buffer.from(
      source.isDirectory
        ? `${source.name.replace(/\\/g, "/").replace(/\/+$/, "")}/`
        : source.name.replace(/\\/g, "/"),
      "utf8",
    );

    if (source.isDirectory) {
      const header = localHeader({
        name,
        flags: FLAG_UTF8,
        method: METHOD_STORE,
        crc: 0,
        compressedSize: 0,
        uncompressedSize: 0,
        stamp,
      });
      yield header;
      central.push({
        name,
        flags: FLAG_UTF8,
        method: METHOD_STORE,
        crc: 0,
        compressedSize: 0,
        uncompressedSize: 0,
        offset,
        isDirectory: true,
        stamp,
      });
      offset += header.length;
      continue;
    }

    const flags = FLAG_UTF8 | FLAG_DATA_DESCRIPTOR;
    const header = localHeader({
      name,
      flags,
      method: METHOD_DEFLATE,
      crc: 0,
      compressedSize: 0,
      uncompressedSize: 0,
      stamp,
    });
    yield header;
    const entryOffset = offset;
    offset += header.length;

    const webStream = await source.open();
    const input = Readable.fromWeb(
      webStream as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
    );
    let crc = 0;
    let uncompressedSize = 0;
    input.on("data", (chunk: Buffer) => {
      crc = crc32(chunk, crc);
      uncompressedSize += chunk.length;
    });

    const deflate = createDeflateRaw({ level: 6 });
    input.pipe(deflate);
    let compressedSize = 0;
    for await (const chunk of deflate as AsyncIterable<Buffer>) {
      compressedSize += chunk.length;
      yield chunk;
    }

    if (uncompressedSize >= 0xffffffff || compressedSize >= 0xffffffff) {
      throw new Error("单个文件超过 4GB，暂不支持写入 zip");
    }
    const descriptor = dataDescriptor(crc, compressedSize, uncompressedSize);
    yield descriptor;
    offset += compressedSize + descriptor.length;

    central.push({
      name,
      flags,
      method: METHOD_DEFLATE,
      crc,
      compressedSize,
      uncompressedSize,
      offset: entryOffset,
      isDirectory: false,
      stamp,
    });
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const record of central) {
    const header = centralHeader(record);
    centralSize += header.length;
    yield header;
  }

  if (centralStart >= 0xffffffff || centralSize >= 0xffffffff) {
    throw new Error("压缩包超过 4GB，暂不支持 zip64");
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  yield eocd;
}

/**
 * 流式 zip 生成器：逐条目 deflate，文件数据用完即释放。
 * 使用 data descriptor（中央目录中回填真实大小），无需预先知道文件大小。
 */
export function createZipStream(sources: ZipSource[]): ReadableStream<Uint8Array> {
  const iterator = zipIterator(sources);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();
      if (next.done) {
        controller.close();
        return;
      }
      controller.enqueue(next.value);
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });
}
