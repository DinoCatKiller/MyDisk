import { relations } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { shareStatusEnum } from "./enums";
import { fileNode } from "./file";

/** 分享链接：文件与文件夹共用，可带密码与有效期 */
export const shareLink = pgTable(
  "share_link",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 10 位短码，URL /share/<token> */
    token: text("token").notNull().unique(),
    nodeId: uuid("node_id")
      .notNull()
      .references(() => fileNode.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** scrypt 哈希，null 表示无密码 */
    passwordHash: text("password_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    maxDownloads: integer("max_downloads"),
    downloadCount: integer("download_count").default(0).notNull(),
    canPreview: boolean("can_preview").default(true).notNull(),
    canDownload: boolean("can_download").default(true).notNull(),
    canList: boolean("can_list").default(true).notNull(),
    status: shareStatusEnum("status").default("active").notNull(),
    lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("share_link_creator_idx").on(table.createdBy, table.createdAt),
    index("share_link_node_idx").on(table.nodeId),
  ],
);

export const shareAccessLog = pgTable(
  "share_access_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareId: uuid("share_id")
      .notNull()
      .references(() => shareLink.id, { onDelete: "cascade" }),
    /** view / preview / download / password_fail */
    action: text("action").notNull(),
    nodeId: uuid("node_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("share_access_log_share_idx").on(table.shareId, table.createdAt)],
);

export const shareLinkRelations = relations(shareLink, ({ one, many }) => ({
  node: one(fileNode, {
    fields: [shareLink.nodeId],
    references: [fileNode.id],
  }),
  creator: one(user, {
    fields: [shareLink.createdBy],
    references: [user.id],
  }),
  accessLogs: many(shareAccessLog),
}));

export const shareAccessLogRelations = relations(shareAccessLog, ({ one }) => ({
  share: one(shareLink, {
    fields: [shareAccessLog.shareId],
    references: [shareLink.id],
  }),
}));

export type ShareLinkRow = typeof shareLink.$inferSelect;
export type NewShareLink = typeof shareLink.$inferInsert;
export type ShareAccessLogRow = typeof shareAccessLog.$inferSelect;
