import { pgEnum } from "drizzle-orm/pg-core";

/** 管理员角色：founder 全局唯一且不可删除/降级 */
export const userRoleEnum = pgEnum("user_role", ["founder", "admin"]);
export const userStatusEnum = pgEnum("user_status", ["active", "disabled"]);

/** 存储连接类型：本地连接全库唯一 */
export const storageTypeEnum = pgEnum("storage_type", ["local", "cos", "oss", "s3"]);
export const connectionStatusEnum = pgEnum("connection_status", ["active", "disabled", "error"]);
/** 切换默认连接后的同步状态 */
export const connectionSyncStatusEnum = pgEnum("connection_sync_status", [
  "synced",
  "pending",
  "skipped",
  "syncing",
]);

export const nodeTypeEnum = pgEnum("node_type", ["file", "folder"]);
export const nodeStatusEnum = pgEnum("node_status", ["active", "uploading", "failed", "trashed"]);

export const uploadStatusEnum = pgEnum("upload_status", [
  "pending",
  "uploading",
  "paused",
  "completed",
  "aborted",
  "failed",
]);

export const shareStatusEnum = pgEnum("share_status", ["active", "expired", "revoked"]);

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

export const taskTypeEnum = pgEnum("task_type", [
  "compress",
  "extract",
  "package_download",
  "thumbnail",
  "purge",
]);
export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const syncConflictEnum = pgEnum("sync_conflict", ["keep_both", "overwrite", "skip"]);

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type UserStatus = (typeof userStatusEnum.enumValues)[number];
export type StorageType = (typeof storageTypeEnum.enumValues)[number];
export type ConnectionStatus = (typeof connectionStatusEnum.enumValues)[number];
export type ConnectionSyncStatus = (typeof connectionSyncStatusEnum.enumValues)[number];
export type NodeType = (typeof nodeTypeEnum.enumValues)[number];
export type NodeStatus = (typeof nodeStatusEnum.enumValues)[number];
export type UploadStatus = (typeof uploadStatusEnum.enumValues)[number];
export type ShareStatus = (typeof shareStatusEnum.enumValues)[number];
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];
export type TaskType = (typeof taskTypeEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
export type SyncConflict = (typeof syncConflictEnum.enumValues)[number];
