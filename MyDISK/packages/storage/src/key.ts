import { randomBytes } from "node:crypto";
import { extname } from "node:path";

/**
 * 生成物理键：<connectionId>/<yyyy>/<MM>/<unixMs>-<rand><ext>
 * 原始文件名保存在 file_node.name，下载时通过 Content-Disposition 还原。
 */
export function buildStorageKey(
  connectionId: string,
  originalName: string,
  timestamp: number = Date.now(),
): string {
  const ext = extname(originalName).toLowerCase();
  const rand = randomBytes(4).toString("hex");
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${connectionId}/${year}/${month}/${timestamp}-${rand}${ext}`;
}

/** 临时分片目录键（本地驱动用） */
export function buildTempPrefix(connectionId: string, uploadId: string): string {
  return `${connectionId}/.tmp/${uploadId}`;
}
