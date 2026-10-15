import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

/** 加密敏感配置（存储密钥、SMTP 密码），输出 iv.tag.payload 的 base64 组合 */
export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string, secret: string): string {
  const [ivPart, tagPart, dataPart] = payload.split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("密文格式不正确");
  }
  const decipher = createDecipheriv(ALGORITHM, deriveKey(secret), Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** 展示用脱敏：保留前 4 位与后 4 位 */
export function maskSecret(value: string): string {
  if (!value) {
    return "";
  }
  if (value.length <= 8) {
    return "****";
  }
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}
