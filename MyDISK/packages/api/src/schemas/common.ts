import * as z from "zod";

/** 统一分页输入（`A3` §1.3） */
export const paginationSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(500).default(50),
});

/** 统一排序输入（`A3` §1.3） */
export const sortSchema = z.object({
  field: z.enum(["name", "size", "createdAt", "updatedAt", "type"]),
  order: z.enum(["asc", "desc"]),
});

/** 统一分页返回 `{ items, total, page, pageSize }`（`A3` §1.3） */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
  });
}

/** 通用成功返回 */
export const okSchema = z.object({ ok: z.boolean() });

/**
 * URL query / path 里的十进制非负整数（二进制面用，`A3` §7）。
 * 不能直接用 `z.coerce.number()`：`Number("")` 是 0，会把「缺参数」静默当成 0。
 */
export const queryIntSchema = z
  .string()
  .regex(/^\d+$/, "必须为非负整数")
  .transform((value) => Number(value))
  .pipe(z.number().int().nonnegative());
