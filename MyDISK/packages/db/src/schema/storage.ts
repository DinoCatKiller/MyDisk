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
import { connectionStatusEnum, connectionSyncStatusEnum, storageTypeEnum } from "./enums";

/**
 * 存储连接配置（整体 AES-256-GCM 加密后存 config_enc）。
 * 本地连接额外使用 root 指定根目录，默认 <project>/storage。
 */
export type StorageConnectionConfig = {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /** S3 兼容服务需要 */
  forcePathStyle?: boolean;
  /** 本地连接根目录（绝对路径或相对项目根） */
  root?: string;
};

export const storageConnection = pgTable(
  "storage_connection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    type: storageTypeEnum("type").notNull(),
    isDefault: boolean("is_default").default(false).notNull(),
    status: connectionStatusEnum("status").default("active").notNull(),
    bucket: text("bucket"),
    region: text("region"),
    endpoint: text("endpoint"),
    rootPrefix: text("root_prefix").default("").notNull(),
    /** 加密后的完整配置 JSON */
    configEnc: text("config_enc"),
    /** 脱敏配置，供前端展示 */
    configMasked: jsonb("config_masked").$type<Record<string, string>>().default({}).notNull(),
    totalSize: bigint("total_size", { mode: "number" }).default(0).notNull(),
    fileCount: integer("file_count").default(0).notNull(),
    syncStatus: connectionSyncStatusEnum("sync_status").default("synced").notNull(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    // 全局唯一的默认连接
    uniqueIndex("connection_default_uidx")
      .on(table.isDefault)
      .where(sql`${table.isDefault} = true`),
    // 本地连接全库唯一
    uniqueIndex("connection_local_uidx")
      .on(table.type)
      .where(sql`${table.type} = 'local'`),
    index("connection_status_idx").on(table.status),
  ],
);

export type StorageConnectionRow = typeof storageConnection.$inferSelect;
export type NewStorageConnection = typeof storageConnection.$inferInsert;
