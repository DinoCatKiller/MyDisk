import { asc, eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as z from "zod";

import { storageConnection } from "@MyDISK/db/schema";

import { protectedProcedure } from "../index";
import { toPublicConnection } from "../lib/connections";

const list = protectedProcedure
  .route({
    method: "GET",
    path: "/connections",
    summary: "存储连接列表（脱敏）",
    tags: ["connection"],
  })
  .handler(async ({ context }) => {
    const rows = await context.db
      .select()
      .from(storageConnection)
      .orderBy(asc(storageConnection.createdAt));
    return rows.map(toPublicConnection);
  });

const get = protectedProcedure
  .route({
    method: "GET",
    path: "/connections/{id}",
    summary: "获取单个存储连接（脱敏）",
    tags: ["connection"],
  })
  .input(z.object({ id: z.uuid() }))
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
    return toPublicConnection(row);
  });

export const connectionRouter = {
  list,
  get,
};
