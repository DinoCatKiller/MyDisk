import * as z from "zod";

/** `/api/raw/:nodeId` 的路径参数（`A3` §7） */
export const rawNodeIdSchema = z.uuid();

/**
 * `/api/raw/:nodeId` 的 query（`A3` §7）。
 * `dl` / `inline` 只认 `"1"`（与 `A3` §11.4 手写 spec 的 `enum: ["1"]` 一致），输出归一为 boolean。
 */
export const rawQuerySchema = z.object({
  token: z.string().min(1).optional(),
  dl: z
    .literal("1")
    .optional()
    .transform((value) => value === "1"),
  inline: z
    .literal("1")
    .optional()
    .transform((value) => value === "1"),
});

export type RawQuery = z.infer<typeof rawQuerySchema>;

/** 短时签名令牌载荷（`A3` §7）；签发见 `lib/raw-token.ts` */
export const rawTokenPayloadSchema = z.object({
  nodeId: z.uuid(),
  userId: z.string().min(1),
  /** 过期时间（秒级 unix 时间戳） */
  exp: z.number().int().positive(),
});

export type RawTokenPayload = z.infer<typeof rawTokenPayloadSchema>;

/** 单段字节区间（含端点） */
export const byteRangeSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

export type ByteRange = z.infer<typeof byteRangeSchema>;

/**
 * 按实体大小解析请求头 `Range`（只支持单段 `bytes=` 形式，`A3` §7）。
 * - 无 Range 头 → `null`：调用方返回完整流
 * - `bytes=N-M` / `bytes=N-`（到结尾）/ `bytes=-N`（末尾 N 字节）→ 区间
 * - 语法非法或区间不可满足（越界、空实体）→ 解析失败：调用方返回 `416`
 *
 * 之所以是工厂函数：`bytes=-N` 与 `bytes=N-` 的边界只有知道实体大小才能确定。
 */
export function byteRangeHeaderSchema(size: number) {
  return z
    .string()
    .nullish()
    .transform((header, ctx) => {
      const value = header?.trim() ?? "";
      if (!value) {
        return null;
      }

      const unsatisfiable = () => {
        ctx.addIssue({ code: "custom", message: "Range 区间不可满足" });
        return z.NEVER;
      };

      const match = /^bytes=(\d*)-(\d*)$/.exec(value);
      if (!match) {
        ctx.addIssue({ code: "custom", message: "Range 头格式非法" });
        return z.NEVER;
      }
      const [, rawStart = "", rawEnd = ""] = match;
      if (rawStart === "" && rawEnd === "") {
        return unsatisfiable();
      }

      if (rawStart === "") {
        // 后缀区间：bytes=-N 表示最后 N 字节
        const suffix = Number(rawEnd);
        if (!(suffix > 0)) {
          return unsatisfiable();
        }
        return { start: Math.max(0, size - suffix), end: size - 1 };
      }

      const start = Number(rawStart);
      if (!(start < size)) {
        return unsatisfiable();
      }
      const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
      if (end < start) {
        return unsatisfiable();
      }
      return { start, end };
    })
    .pipe(byteRangeSchema.nullable());
}
