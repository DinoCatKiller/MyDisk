/**
 * 上传指纹：`hash(name + size + mtime + relativePath)`。
 *
 * 优先走 `crypto.subtle` 的 SHA-256（64 位 hex，满足后端 `min(8).max(256)`）；
 * 在无 WebCrypto 的环境（SSR / 非安全上下文）降级为稳定的本地 32 位散列。
 */
export type FingerprintInput = {
  name: string;
  size: number;
  mtime: number;
  relativePath?: string | null;
};

const HEX = "0123456789abcdef";

function fallbackHash(raw: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    h1 = (h1 ^ code) >>> 0;
    h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (h2 + code) >>> 0;
    h2 = Math.imul(h2, 2246822519) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 8; i += 1) {
    out += HEX[(h1 >>> (i * 4)) & 0x0f];
    out += HEX[(h2 >>> (i * 4)) & 0x0f];
  }
  return out;
}

function toHex(buffer: ArrayBuffer): string {
  let out = "";
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    out += HEX[(byte >>> 4) & 0x0f];
    out += HEX[byte & 0x0f];
  }
  return out;
}

export async function fingerprintOf(input: FingerprintInput): Promise<string> {
  const raw = [input.name, input.size, input.mtime, input.relativePath ?? ""].join("::");
  const subtle = typeof crypto !== "undefined" ? crypto.subtle : undefined;
  if (subtle) {
    try {
      const digest = await subtle.digest("SHA-256", new TextEncoder().encode(raw));
      return toHex(digest);
    } catch {
      return fallbackHash(raw);
    }
  }
  return fallbackHash(raw);
}
