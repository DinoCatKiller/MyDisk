import { and, asc, count, eq, isNull, ne, sum } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as z from "zod";

import { fileNode, storageConnection } from "@MyDISK/db/schema";
import { createStorageDriver, encryptSecret } from "@MyDISK/storage";

import { driverFor, normalizeConnectionConfig } from "../lib/connections";
import { founderProcedure, protectedProcedure } from "../procedure";
import {
  connectionCreateInput,
  connectionIdInput,
  connectionSetDefaultInput,
  connectionSetDefaultOutput,
  connectionTestInput,
  connectionTestOutput,
  connectionUpdateInput,
  connectionUsageOutput,
  publicConnectionSchema,
} from "../schemas/connection";

const list = protectedProcedure
  .route({
    method: "GET",
    path: "/connections",
    summary: "存储连接列表（脱敏）",
    tags: ["connection"],
  })
  .output(z.array(publicConnectionSchema))
  .handler(async ({ context }) => {
    const rows = await context.db
      .select()
      .from(storageConnection)
      .orderBy(asc(storageConnection.createdAt));
    return rows.map((row) => publicConnectionSchema.parse(row));
  });

const get = protectedProcedure
  .route({
    method: "GET",
    path: "/connections/{id}",
    summary: "获取单个存储连接（脱敏）",
    tags: ["connection"],
  })
  .input(connectionIdInput)
  .output(publicConnectionSchema)
  .handler(async ({ input, context }) => {
    const rows = await context.db
      .select()
      .from(storageConnection)
      .where(eq(storageConnection.id, input.id))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new ORPCError("NOT_FOUND", { message: "存储连接不存在" });
    }
    return publicConnectionSchema.parse(row);
  });

const create = founderProcedure
  .route({
    method: "POST",
    path: "/connections",
    summary: "新建存储连接",
    tags: ["connection"],
  })
  .input(connectionCreateInput)
  .output(publicConnectionSchema)
  .handler(async ({ input, context }) => {
    const sameName = await context.db
      .select({ id: storageConnection.id })
      .from(storageConnection)
      .where(eq(storageConnection.name, input.name))
      .limit(1);
    if (sameName[0]) {
      throw new ORPCError("ALREADY_EXISTS", { message: `连接名称「${input.name}」已被占用` });
    }

    if (input.type === "local") {
      const local = await context.db
        .select({ id: storageConnection.id })
        .from(storageConnection)
        .where(eq(storageConnection.type, "local"))
        .limit(1);
      if (local[0]) {
        throw new ORPCError("STORAGE_LOCAL_DUPLICATE", {
          message: "本地连接全库唯一，已存在一个本地连接",
        });
      }
    }

    const normalized = normalizeConnectionConfig(
      input.type,
      "config" in input ? input.config : null,
    );
    const configEnc = normalized.config
      ? encryptSecret(JSON.stringify(normalized.config), context.encryptionKey)
      : null;

    const countRow = await context.db.select({ total: count() }).from(storageConnection);
    const total = countRow[0]?.total ?? 0;

    const rows = await context.db
      .insert(storageConnection)
      .values({
        name: input.name,
        type: input.type,
        bucket: "bucket" in input ? input.bucket : null,
        region: "region" in input ? input.region : null,
        endpoint: "endpoint" in input ? input.endpoint || null : null,
        rootPrefix: input.rootPrefix,
        configEnc,
        configMasked: normalized.masked,
        isDefault: total === 0,
        createdBy: context.user.id,
      })
      .returning();

    const row = rows[0];
    if (!row) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "创建存储连接失败" });
    }
    return publicConnectionSchema.parse(row);
  });

const update = founderProcedure
  .route({
    method: "PATCH",
    path: "/connections/{id}",
    summary: "修改存储连接",
    tags: ["connection"],
  })
  .input(connectionUpdateInput)
  .output(publicConnectionSchema)
  .handler(async ({ input, context }) => {
    const rows = await context.db
      .select()
      .from(storageConnection)
      .where(eq(storageConnection.id, input.id))
      .limit(1);
    const current = rows[0];
    if (!current) {
      throw new ORPCError("NOT_FOUND", { message: "存储连接不存在" });
    }

    if (input.name !== undefined && input.name !== current.name) {
      const sameName = await context.db
        .select({ id: storageConnection.id })
        .from(storageConnection)
        .where(and(eq(storageConnection.name, input.name), ne(storageConnection.id, input.id)))
        .limit(1);
      if (sameName[0]) {
        throw new ORPCError("ALREADY_EXISTS", { message: `连接名称「${input.name}」已被占用` });
      }
    }

    let configEnc = current.configEnc;
    let configMasked = current.configMasked;
    if (input.config !== undefined) {
      const normalized = normalizeConnectionConfig(current.type, input.config);
      configEnc = normalized.config
        ? encryptSecret(JSON.stringify(normalized.config), context.encryptionKey)
        : null;
      configMasked = normalized.masked;
    }

    const updated = await context.db
      .update(storageConnection)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.bucket !== undefined ? { bucket: input.bucket || null } : {}),
        ...(input.region !== undefined ? { region: input.region || null } : {}),
        ...(input.endpoint !== undefined ? { endpoint: input.endpoint || null } : {}),
        ...(input.rootPrefix !== undefined ? { rootPrefix: input.rootPrefix } : {}),
        configEnc,
        configMasked,
      })
      .where(eq(storageConnection.id, input.id))
      .returning();

    const row = updated[0];
    if (!row) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "更新存储连接失败" });
    }
    return publicConnectionSchema.parse(row);
  });

const remove = founderProcedure
  .route({
    method: "DELETE",
    path: "/connections/{id}",
    summary: "删除存储连接",
    tags: ["connection"],
  })
  .input(connectionIdInput)
  .output(z.object({ ok: z.boolean() }))
  .handler(async ({ input, context }) => {
    const rows = await context.db
      .select()
      .from(storageConnection)
      .where(eq(storageConnection.id, input.id))
      .limit(1);
    const current = rows[0];
    if (!current) {
      throw new ORPCError("NOT_FOUND", { message: "存储连接不存在" });
    }
    if (current.isDefault) {
      throw new ORPCError("CONFLICT", {
        message: "默认连接不可删除，请先把其它连接设为默认",
      });
    }

    // 包含回收站：删除连接会因外键级联丢掉 file_node 行，必须要求先清空，避免静默丢数据
    const fileCountRows = await context.db
      .select({ files: count() })
      .from(fileNode)
      .where(eq(fileNode.connectionId, input.id));
    const files = fileCountRows[0]?.files ?? 0;

    if (files > 0) {
      throw new ORPCError("CONFLICT", {
        message: `该连接下仍有 ${files} 个文件（含回收站），请先清空后再删除`,
      });
    }

    await context.db.delete(storageConnection).where(eq(storageConnection.id, input.id));
    return { ok: true };
  });

const test = founderProcedure
  .route({
    method: "POST",
    path: "/connections/test",
    summary: "测试存储连接连通性",
    tags: ["connection"],
  })
  .input(connectionTestInput)
  .output(connectionTestOutput)
  .handler(async ({ input, context }) => {
    let driver;
    if ("id" in input) {
      const rows = await context.db
        .select()
        .from(storageConnection)
        .where(eq(storageConnection.id, input.id))
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw new ORPCError("NOT_FOUND", { message: "存储连接不存在" });
      }
      driver = driverFor(row, context.storageRoot, context.encryptionKey);
    } else {
      const draft = input.draft;
      const normalized = normalizeConnectionConfig(
        draft.type,
        "config" in draft ? draft.config : null,
      );
      driver = createStorageDriver(
        {
          id: "draft",
          type: draft.type,
          bucket: "bucket" in draft ? draft.bucket : null,
          region: "region" in draft ? draft.region : null,
          endpoint: "endpoint" in draft ? draft.endpoint || null : null,
          rootPrefix: draft.rootPrefix,
          config: normalized.config,
        },
        { localRoot: context.storageRoot },
      );
    }

    const startedAt = Date.now();
    try {
      // 列举根前缀同时验证凭证与列举权限；空桶返回空数组也算成功
      await driver.list("");
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

const setDefault = founderProcedure
  .route({
    method: "POST",
    path: "/connections/{id}/default",
    summary: "设为默认存储连接",
    tags: ["connection"],
  })
  .input(connectionSetDefaultInput)
  .output(connectionSetDefaultOutput)
  .handler(async ({ input, context }) => {
    if (input.sync === "now") {
      throw new ORPCError("NOT_IMPLEMENTED", {
        message: "跨连接同步将在 P3-6 提供，请选择稍后手动同步",
      });
    }

    const rows = await context.db
      .select()
      .from(storageConnection)
      .where(eq(storageConnection.id, input.id))
      .limit(1);
    if (!rows[0]) {
      throw new ORPCError("NOT_FOUND", { message: "存储连接不存在" });
    }

    await context.db.transaction(async (tx) => {
      await tx
        .update(storageConnection)
        .set({ isDefault: false })
        .where(eq(storageConnection.isDefault, true));
      await tx
        .update(storageConnection)
        .set({ isDefault: true, status: "active", lastError: null })
        .where(eq(storageConnection.id, input.id));
    });

    return { switched: true };
  });

const usage = protectedProcedure
  .route({
    method: "GET",
    path: "/connections/{id}/usage",
    summary: "存储连接用量（未删除文件聚合）",
    tags: ["connection"],
  })
  .input(connectionIdInput)
  .output(connectionUsageOutput)
  .handler(async ({ input, context }) => {
    const rows = await context.db
      .select({ id: storageConnection.id })
      .from(storageConnection)
      .where(eq(storageConnection.id, input.id))
      .limit(1);
    if (!rows[0]) {
      throw new ORPCError("NOT_FOUND", { message: "存储连接不存在" });
    }

    const [aggregate] = await context.db
      .select({ totalSize: sum(fileNode.size), fileCount: count() })
      .from(fileNode)
      .where(and(eq(fileNode.connectionId, input.id), isNull(fileNode.deletedAt)));

    return {
      totalSize: Number(aggregate?.totalSize ?? 0),
      fileCount: Number(aggregate?.fileCount ?? 0),
    };
  });

export const connectionRouter = {
  list,
  get,
  create,
  update,
  delete: remove,
  test,
  setDefault,
  usage,
};
