import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { nodeStatusEnum, nodeTypeEnum, uploadStatusEnum } from "./enums";
import { storageConnection } from "./storage";

/** 文件与文件夹共用一棵树，parent_id 为 null 表示连接根 */
export type FileNodeMeta = {
  width?: number;
  height?: number;
  duration?: number;
  pages?: number;
  thumbKey?: string;
  previewCache?: string;
};

export const fileNode = pgTable(
  "file_node",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => storageConnection.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => fileNode.id, {
      onDelete: "cascade",
    }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: nodeTypeEnum("type").notNull(),
    /** 展示名（原始文件名，物理键另有其名） */
    name: text("name").notNull(),
    /** 物理键：<connectionId>/<yyyy>/<MM>/<ts>-<rand><ext> */
    storageKey: text("storage_key").notNull(),
    mime: text("mime"),
    ext: text("ext"),
    size: bigint("size", { mode: "number" }).default(0).notNull(),
    checksum: text("checksum"),
    status: nodeStatusEnum("status").default("active").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
    isFavorite: boolean("is_favorite").default(false).notNull(),
    meta: jsonb("meta").$type<FileNodeMeta>().default({}).notNull(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // 同一目录下未删除的同名节点唯一
    uniqueIndex("file_node_name_uidx")
      .on(
        table.connectionId,
        sql`COALESCE(${table.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        table.name,
      )
      .where(sql`${table.deletedAt} is null`),
    index("file_node_parent_idx").on(table.connectionId, table.parentId, table.type),
    index("file_node_owner_idx").on(table.ownerId),
    index("file_node_checksum_idx").on(table.checksum),
    index("file_node_trash_idx").on(table.deletedAt),
  ],
);

/** 分片上传会话：断点续传与刷新恢复的唯一依据 */
export type UploadPartMeta = {
  partNumber: number;
  etag?: string;
  size?: number;
};

export const uploadSession = pgTable(
  "upload_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => storageConnection.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references(() => fileNode.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** hash(name + size + lastModified + parentId + userId) */
    fingerprint: text("fingerprint").notNull(),
    originalName: text("original_name").notNull(),
    /** 文件夹上传时的相对路径 */
    relativePath: text("relative_path"),
    mime: text("mime"),
    size: bigint("size", { mode: "number" }).notNull(),
    chunkSize: integer("chunk_size").notNull(),
    totalChunks: integer("total_chunks").notNull(),
    uploadedParts: jsonb("uploaded_parts").$type<number[]>().default([]).notNull(),
    partsMeta: jsonb("parts_meta").$type<UploadPartMeta[]>().default([]).notNull(),
    /** COS/OSS/S3 的 multipart uploadId */
    providerUploadId: text("provider_upload_id"),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256"),
    status: uploadStatusEnum("status").default("pending").notNull(),
    error: text("error"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("upload_session_user_fingerprint_uidx").on(table.userId, table.fingerprint),
    index("upload_session_status_idx").on(table.status, table.updatedAt),
  ],
);

export type FileNodeRow = typeof fileNode.$inferSelect;
export type NewFileNode = typeof fileNode.$inferInsert;
export type UploadSessionRow = typeof uploadSession.$inferSelect;
export type NewUploadSession = typeof uploadSession.$inferInsert;
