import type { StorageBody } from "../types";

/**
 * 把驱动收到的任意 body 读成 Buffer。
 *
 * 云 SDK（aws-sdk / cos / oss）对长度未知的 Node 流支持不稳，而进入驱动的
 * body 只有两种来源：小文件直传（几 MB 内）与分片（≤ UPLOAD_CHUNK_SIZE，
 * 默认 8MB），整体缓冲的内存上界可控；本地驱动不走这里，仍保持流式直写。
 */
export async function toBuffer(body: StorageBody): Promise<Buffer> {
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  if (body instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(body));
  }
  const stream = body as ReadableStream<Uint8Array>;
  if (typeof stream.getReader !== "function") {
    throw new TypeError(`不支持的存储 body 类型: ${typeof body}`);
  }
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/** 拼接 rootPrefix（去掉首尾斜杠），无前缀时原样返回 */
export function applyPrefix(prefix: string | null | undefined, key: string): string {
  const clean = (prefix ?? "").replace(/^\/+|\/+$/g, "");
  return clean ? `${clean}/${key}` : key;
}
