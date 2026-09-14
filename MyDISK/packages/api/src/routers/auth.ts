import { eq } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import * as z from "zod";

import { user } from "@MyDISK/db/schema";

import { founderProcedure, protectedProcedure, publicProcedure } from "../index";

/** 把 Better-Auth 返回的 Set-Cookie 收集到响应头，由 server 层写入最终响应 */
function appendSetCookies(target: Headers, source: Headers): void {
  const getSetCookie = (source as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = typeof getSetCookie === "function" ? getSetCookie.call(source) : [];
  if (cookies.length > 0) {
    for (const cookie of cookies) {
      target.append("set-cookie", cookie);
    }
    return;
  }
  const single = source.get("set-cookie");
  if (single) {
    target.append("set-cookie", single);
  }
}

const emailSchema = z.email({ message: "邮箱格式不正确" });

const signInInput = z.object({
  email: emailSchema,
  password: z.string().min(1, "请输入密码"),
  rememberMe: z.boolean().optional(),
});

const changePasswordInput = z.object({
  currentPassword: z.string().min(1, "请输入当前密码"),
  newPassword: z.string().min(8, "新密码至少 8 位"),
});

const updateProfileInput = z.object({
  name: z.string().min(1).max(64).optional(),
  image: z.string().url().nullish(),
});

const createAdminInput = z.object({
  email: emailSchema,
  name: z.string().min(1).max(64),
  password: z.string().min(8, "密码至少 8 位"),
  mustChangePassword: z.boolean().optional(),
});

const getSession = publicProcedure
  .route({
    method: "GET",
    path: "/auth/session",
    summary: "获取当前会话",
    tags: ["auth"],
  })
  .handler(({ context }) => {
    if (!context.session?.user) {
      return null;
    }
    return {
      user: context.session.user,
      expiresAt: context.session.session?.expiresAt ?? null,
    };
  });

const signIn = publicProcedure
  .route({
    method: "POST",
    path: "/auth/sign-in",
    summary: "管理员登录",
    description: "邮箱 + 密码登录，成功后在响应头写入会话 Cookie",
    tags: ["auth"],
  })
  .input(signInInput)
  .handler(async ({ input, context }) => {
    const existing = await context.db
      .select({ id: user.id, status: user.status })
      .from(user)
      .where(eq(user.email, input.email))
      .limit(1);

    const account = existing[0];
    if (account && account.status === "disabled") {
      throw new ORPCError("FORBIDDEN", { message: "账户已被禁用，请联系创始人管理员" });
    }

    const result = await context.auth.api.signInEmail({
      body: {
        email: input.email,
        password: input.password,
        rememberMe: input.rememberMe ?? true,
      },
      returnHeaders: true,
    });

    appendSetCookies(context.responseHeaders, result.headers);

    const signedInUser = result.response.user;
    await context.db
      .update(user)
      .set({
        lastLoginAt: new Date(),
        lastLoginIp: context.requestInfo.ip,
      })
      .where(eq(user.id, signedInUser.id));

    return {
      user: signedInUser,
      mustChangePassword: Boolean(
        (signedInUser as { mustChangePassword?: boolean }).mustChangePassword,
      ),
    };
  });

const signOut = protectedProcedure
  .route({
    method: "POST",
    path: "/auth/sign-out",
    summary: "退出登录",
    tags: ["auth"],
  })
  .handler(async ({ context }) => {
    const result = await context.auth.api.signOut({
      headers: context.headers,
      returnHeaders: true,
    });
    appendSetCookies(context.responseHeaders, result.headers);
    return { ok: true };
  });

const changePassword = protectedProcedure
  .route({
    method: "POST",
    path: "/auth/change-password",
    summary: "修改自己的密码",
    description: "需校验原密码；修改后其它会话失效，并清除首次登录强制改密标记",
    tags: ["auth"],
  })
  .input(changePasswordInput)
  .handler(async ({ input, context }) => {
    const result = await context.auth.api.changePassword({
      body: {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        revokeOtherSessions: true,
      },
      headers: context.headers,
      returnHeaders: true,
    });
    appendSetCookies(context.responseHeaders, result.headers);

    await context.db
      .update(user)
      .set({ mustChangePassword: false })
      .where(eq(user.id, context.session.user.id));

    return { ok: true };
  });

const updateProfile = protectedProcedure
  .route({
    method: "PATCH",
    path: "/auth/profile",
    summary: "更新个人资料",
    tags: ["auth"],
  })
  .input(updateProfileInput)
  .handler(async ({ input, context }) => {
    const [updated] = await context.db
      .update(user)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.image === undefined ? {} : { image: input.image }),
      })
      .where(eq(user.id, context.session.user.id))
      .returning();

    return updated;
  });

const listAdmins = founderProcedure
  .route({
    method: "GET",
    path: "/auth/admins",
    summary: "管理员列表",
    tags: ["auth"],
  })
  .handler(async ({ context }) => {
    const rows = await context.db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
      })
      .from(user)
      .orderBy(user.createdAt);
    return rows;
  });

const createAdmin = founderProcedure
  .route({
    method: "POST",
    path: "/auth/admins",
    summary: "新增管理员",
    description: "仅创始人可操作；系统不存在公开注册，账户由该接口创建",
    tags: ["auth"],
  })
  .input(createAdminInput)
  .handler(async ({ input, context }) => {
    const existing = await context.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, input.email))
      .limit(1);
    if (existing.length > 0) {
      throw new ORPCError("CONFLICT", { message: "该邮箱已存在" });
    }

    // adminAuth 允许注册，仅用于服务端建号
    const created = await context.adminAuth.api.signUpEmail({
      body: {
        email: input.email,
        password: input.password,
        name: input.name,
      },
    });

    const [row] = await context.db
      .update(user)
      .set({
        role: "admin",
        status: "active",
        mustChangePassword: input.mustChangePassword ?? true,
      })
      .where(eq(user.id, created.user.id))
      .returning({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
        createdAt: user.createdAt,
      });

    return row;
  });

const deleteAdmin = founderProcedure
  .route({
    method: "DELETE",
    path: "/auth/admins/{userId}",
    summary: "删除管理员",
    description: "创始人不可被删除",
    tags: ["auth"],
  })
  .input(z.object({ userId: z.string().min(1) }))
  .handler(async ({ input, context }) => {
    const rows = await context.db
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1);
    const target = rows[0];
    if (!target) {
      throw new ORPCError("NOT_FOUND", { message: "管理员不存在" });
    }
    if (target.role === "founder") {
      throw new ORPCError("FORBIDDEN", { message: "创始人管理员不可删除" });
    }
    if (target.id === context.session.user.id) {
      throw new ORPCError("FORBIDDEN", { message: "不能删除当前登录账户" });
    }

    await context.db.delete(user).where(eq(user.id, input.userId));
    return { ok: true };
  });

const setAdminStatus = founderProcedure
  .route({
    method: "PATCH",
    path: "/auth/admins/{userId}/status",
    summary: "启用/禁用管理员",
    description: "创始人不可被禁用",
    tags: ["auth"],
  })
  .input(
    z.object({
      userId: z.string().min(1),
      status: z.enum(["active", "disabled"]),
    }),
  )
  .handler(async ({ input, context }) => {
    const rows = await context.db
      .select({ id: user.id, role: user.role })
      .from(user)
      .where(eq(user.id, input.userId))
      .limit(1);
    const target = rows[0];
    if (!target) {
      throw new ORPCError("NOT_FOUND", { message: "管理员不存在" });
    }
    if (target.role === "founder") {
      throw new ORPCError("FORBIDDEN", { message: "创始人管理员不可被禁用" });
    }

    const [row] = await context.db
      .update(user)
      .set({ status: input.status })
      .where(eq(user.id, input.userId))
      .returning({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
      });

    return row;
  });

export const authRouter = {
  getSession,
  signIn,
  signOut,
  changePassword,
  updateProfile,
  listAdmins,
  createAdmin,
  deleteAdmin,
  setAdminStatus,
};
