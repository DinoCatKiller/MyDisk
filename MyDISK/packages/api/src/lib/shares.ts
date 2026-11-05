import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as z from "zod";

import type { Database } from "@MyDISK/db";
import { fileNode, shareLink, type FileNodeRow, type ShareLinkRow } from "@MyDISK/db/schema";

import { publicFileNodeSchema, type PublicFileNode } from "../schemas/share";

const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ACCESS_TOKEN_TTL_SECONDS = 2 * 60 * 60;

/** 10 位字母数字短码（`A6` §4），与 nanoid 字母表一致 */
export function generateShareToken(length = 10): string {
  const bytes = randomBytes(length);
  let token = "";
  for (let index = 0; index < length; index += 1) {
    token += TOKEN_ALPHABET[bytes[index]! % TOKEN_ALPHABET.length];
  }
  return token;
}

/** scrypt 哈希，形如 `scrypt$<salt>$<hash>`（`A6` §4） */
export function hashSharePassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifySharePassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) {
    return false;
  }
  const expected = Buffer.from(hash, "hex");
  const actual = Buffer.from(scryptSync(password, salt, expected.length).toString("hex"), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const accessTokenPayloadSchema = z.object({
  shareId: z.uuid(),
  /** 过期时间（秒级 unix 时间戳） */
  exp: z.number().int().positive(),
});

export type ShareAccessTokenPayload = z.infer<typeof accessTokenPayloadSchema>;

function signAccessBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/** 密码解锁后的短时 access token（绑定 shareId，不引入 Redis 状态） */
export function signShareAccessToken(shareId: string, secret: string): string {
  const body = Buffer.from(
    JSON.stringify({ shareId, exp: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS }),
    "utf8",
  ).toString("base64url");
  return `${body}.${signAccessBody(body, secret)}`;
}

export function verifyShareAccessToken(
  token: string,
  secret: string,
): ShareAccessTokenPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) {
    return null;
  }
  const expected = Buffer.from(signAccessBody(body, secret));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return null;
  }
  let payload: ShareAccessTokenPayload;
  try {
    payload = accessTokenPayloadSchema.parse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
  } catch {
    return null;
  }
  return payload.exp * 1000 < Date.now() ? null : payload;
}

export type LoadedShare = { share: ShareLinkRow; node: FileNodeRow };

/**
 * 按 token 载入分享并校验可用性。
 * 到期但库内仍是 `active` 时顺手回写 `expired`（`A2` §7 状态机）。
 */
export async function loadShare(db: Database, token: string): Promise<LoadedShare> {
  const rows = await db
    .select({ share: shareLink, node: fileNode })
    .from(shareLink)
    .innerJoin(fileNode, eq(shareLink.nodeId, fileNode.id))
    .where(eq(shareLink.token, token))
    .limit(1);

  const row = rows[0];
  if (!row || row.node.deletedAt) {
    throw new ORPCError("NOT_FOUND", { message: "分享不存在或已失效" });
  }

  const { share, node } = row;
  if (share.status === "revoked") {
    throw new ORPCError("FORBIDDEN", { message: "分享已被撤销" });
  }
  if (share.status === "expired") {
    throw new ORPCError("FORBIDDEN", { message: "分享已过期" });
  }
  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) {
    await db.update(shareLink).set({ status: "expired" }).where(eq(shareLink.id, share.id));
    throw new ORPCError("FORBIDDEN", { message: "分享已过期" });
  }
  if (share.maxDownloads !== null && share.downloadCount >= share.maxDownloads) {
    throw new ORPCError("FORBIDDEN", { message: "分享下载次数已达上限" });
  }

  return { share, node };
}

/** 有密码的分享必须携带有效 access token；无密码直接放行 */
export function requireShareAccess(
  share: ShareLinkRow,
  accessToken: string | null | undefined,
  secret: string,
): void {
  if (!share.passwordHash) {
    return;
  }
  if (!accessToken) {
    throw new ORPCError("SHARE_PASSWORD_REQUIRED", { message: "该分享需要密码访问" });
  }
  const payload = verifyShareAccessToken(accessToken, secret);
  if (!payload || payload.shareId !== share.id) {
    throw new ORPCError("SHARE_PASSWORD_REQUIRED", { message: "密码验证已失效，请重新输入" });
  }
}

/** 节点是否属于分享根（含根节点本身），并确保沿途节点未被删除 */
export async function isNodeWithinShare(
  db: Database,
  nodeId: string,
  rootId: string,
): Promise<boolean> {
  let currentId: string | null = nodeId;
  for (let depth = 0; currentId && depth < 100; depth += 1) {
    const rows: { id: string; parentId: string | null; deletedAt: Date | null }[] = await db
      .select({ id: fileNode.id, parentId: fileNode.parentId, deletedAt: fileNode.deletedAt })
      .from(fileNode)
      .where(eq(fileNode.id, currentId))
      .limit(1);
    const row = rows[0];
    if (!row || row.deletedAt) {
      return false;
    }
    if (row.id === rootId) {
      return true;
    }
    currentId = row.parentId;
  }
  return false;
}

/** `file_node` → 公开白名单视图 */
export function publicShareNode(row: FileNodeRow): PublicFileNode {
  return publicFileNodeSchema.parse({
    id: row.id,
    name: row.name,
    type: row.type,
    size: row.size,
    mime: row.mime,
    updatedAt: row.updatedAt,
  });
}
