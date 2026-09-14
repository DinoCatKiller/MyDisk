import { relations } from "drizzle-orm";
import { bigint, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { user } from "./auth";
import { jobStatusEnum, syncConflictEnum } from "./enums";
import { storageConnection } from "./storage";

/** 连接间同步任务（切换默认连接或手动触发） */
export const syncJob = pgTable(
  "sync_job",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromConnectionId: uuid("from_connection_id")
      .notNull()
      .references(() => storageConnection.id, { onDelete: "cascade" }),
    toConnectionId: uuid("to_connection_id")
      .notNull()
      .references(() => storageConnection.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** full / incremental */
    mode: text("mode").default("full").notNull(),
    conflictStrategy: syncConflictEnum("conflict_strategy").default("keep_both").notNull(),
    status: jobStatusEnum("status").default("pending").notNull(),
    totalFiles: integer("total_files").default(0).notNull(),
    processedFiles: integer("processed_files").default(0).notNull(),
    failedFiles: integer("failed_files").default(0).notNull(),
    totalBytes: bigint("total_bytes", { mode: "number" }).default(0).notNull(),
    processedBytes: bigint("processed_bytes", { mode: "number" }).default(0).notNull(),
    progress: integer("progress").default(0).notNull(),
    currentPath: text("current_path"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("sync_job_status_idx").on(table.status)],
);

export const syncJobItem = pgTable(
  "sync_job_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => syncJob.id, { onDelete: "cascade" }),
    sourceNodeId: uuid("source_node_id"),
    targetNodeId: uuid("target_node_id"),
    path: text("path"),
    /** pending / running / completed / failed / skipped */
    status: text("status").default("pending").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("sync_job_item_job_idx").on(table.jobId, table.status)],
);

export const syncJobRelations = relations(syncJob, ({ one, many }) => ({
  fromConnection: one(storageConnection, {
    fields: [syncJob.fromConnectionId],
    references: [storageConnection.id],
    relationName: "syncFromConnection",
  }),
  toConnection: one(storageConnection, {
    fields: [syncJob.toConnectionId],
    references: [storageConnection.id],
    relationName: "syncToConnection",
  }),
  items: many(syncJobItem),
}));

export const syncJobItemRelations = relations(syncJobItem, ({ one }) => ({
  job: one(syncJob, {
    fields: [syncJobItem.jobId],
    references: [syncJob.id],
  }),
}));

export type SyncJobRow = typeof syncJob.$inferSelect;
export type SyncJobItemRow = typeof syncJobItem.$inferSelect;
