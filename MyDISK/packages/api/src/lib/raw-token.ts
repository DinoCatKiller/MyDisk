import { createHmac, timingSafeEqual } from "node:crypto";

import { rawTokenPayloadSchema, type RawTokenPayload } from "../schemas/raw";

/**
 * 二进制面（/api/raw/*）的短时签名令牌。
 * HMAC-SHA256 签名，payload 含资源与用户标识，绑定归属校验由服务端完成。
 */
export type { RawTokenPayload };

function toBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function signRawToken(payload: RawTokenPayload, secret: string): string {
  const body = toBase64Url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export function verifyRawToken(token: string, secret: string): RawTokenPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) {
    return null;
  }
  const expected = sign(body, secret);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return null;
  }
  let parsed: RawTokenPayload;
  try {
    parsed = rawTokenPayloadSchema.parse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
  } catch {
    return null;
  }
  if (parsed.exp * 1000 < Date.now()) {
    return null;
  }
  return parsed;
}

/** 生成 /api/raw 取流地址（相对路径，前端按服务地址拼接） */
export function buildRawUrl(
  nodeId: string,
  token: string,
  options: { download?: boolean; inline?: boolean } = {},
): string {
  const params = new URLSearchParams({ token });
  if (options.download) {
    params.set("dl", "1");
  }
  if (options.inline) {
    params.set("inline", "1");
  }
  return `/api/raw/${nodeId}?${params.toString()}`;
}
