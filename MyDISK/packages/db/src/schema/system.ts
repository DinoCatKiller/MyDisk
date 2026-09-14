import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { taskStatusEnum, taskTypeEnum } from "./enums";
import { fileNode } from "./file";

/** 通用异步任务镜像（真实状态在 BullMQ / Redis） */
export const task = pgTable(
  "task",
  {
    /** 与 BullMQ jobId 保持一致 */
    id: uuid("id").primaryKey().defaultRandom(),
    type: taskTypeEnum("type").notNull(),
    status: taskStatusEnum("status").default("pending").notNull(),
    progress: integer("progress").default(0).notNull(),
    title: text("title"),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}).notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().default({}).notNull(),
    error: text("error"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("task_user_idx").on(table.userId, table.createdAt),
    index("task_status_idx").on(table.status),
  ],
);

/** SMTP 配置，全系统单条记录 */
export const smtpSetting = pgTable("smtp_setting", {
  id: uuid("id").primaryKey().defaultRandom(),
  host: text("host"),
  port: integer("port"),
  secure: boolean("secure").default(true).notNull(),
  user: text("user"),
  /** AES-256-GCM 加密 */
  passEnc: text("pass_enc"),
  fromName: text("from_name"),
  fromEmail: text("from_email"),
  enabled: boolean("enabled").default(false).notNull(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

/** 系统 KV 设置 */
export const systemSetting = pgTable("system_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

export const favorite = pgTable(
  "favorite",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => fileNode.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("favorite_user_node_uidx").on(table.userId, table.nodeId)],
);

export const tag = pgTable("tag", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const fileTag = pgTable(
  "file_tag",
  {
    nodeId: uuid("node_id")
      .notNull()
      .references(() => fileNode.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.nodeId, table.tagId] })],
);

/** WebDAV 专用令牌，明文仅创建时返回一次 */
export const webdavToken = pgTable(
  "webdav_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("webdav_token_user_idx").on(table.userId)],
);

/** 敏感操作审计 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id"),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    meta: jsonb("meta").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_user_idx").on(table.userId, table.createdAt),
    index("audit_log_action_idx").on(table.action),
    index("audit_log_target_idx").on(table.targetType, table.targetId),
  ],
);

export const favoriteRelations = relations(favorite, ({ one }) => ({
  user: one(user, { fields: [favorite.userId], references: [user.id] }),
  node: one(fileNode, { fields: [favorite.nodeId], references: [fileNode.id] }),
}));

export const fileTagRelations = relations(fileTag, ({ one }) => ({
  node: one(fileNode, { fields: [fileTag.nodeId], references: [fileNode.id] }),
  tag: one(tag, { fields: [fileTag.tagId], references: [tag.id] }),
}));

export const taskRelations = relations(task, ({ one }) => ({
  owner: one(user, { fields: [task.userId], references: [user.id] }),
}));

export type TaskRow = typeof task.$inferSelect;
export type NewTask = typeof task.$inferInsert;
export type SystemSettingRow = typeof systemSetting.$inferSelect;
export type SmtpSettingRow = typeof smtpSetting.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type WebdavTokenRow = typeof webdavToken.$inferSelect;
export type FavoriteRow = typeof favorite.$inferSelect;
export type TagRow = typeof tag.$inferSelect;
