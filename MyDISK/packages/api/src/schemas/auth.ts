import * as z from "zod";

import { MIN_PASSWORD_LENGTH } from "@MyDISK/auth/password";
import { userRoleEnum, userStatusEnum } from "@MyDISK/db/schema";

export const emailSchema = z.email({ message: "邮箱格式不正确" });

export const signInInput = z.object({
  email: emailSchema,
  password: z.string().min(1, "请输入密码"),
  rememberMe: z.boolean().optional(),
});

export const changePasswordInput = z.object({
  currentPassword: z.string().min(1, "请输入当前密码"),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH, `新密码至少 ${MIN_PASSWORD_LENGTH} 位`),
});

export const updateProfileInput = z.object({
  name: z.string().min(1).max(64).optional(),
  image: z.string().url().nullish(),
});

export const createAdminInput = z.object({
  email: emailSchema,
  name: z.string().min(1).max(64),
  password: z.string().min(MIN_PASSWORD_LENGTH, `密码至少 ${MIN_PASSWORD_LENGTH} 位`),
  mustChangePassword: z.boolean().optional(),
});

export const deleteAdminInput = z.object({ userId: z.string().min(1) });

export const setAdminStatusInput = z.object({
  userId: z.string().min(1),
  status: z.enum(["active", "disabled"]),
});

/** Better-Auth 会话用户（只声明前端会用到的字段，多余字段自动 strip） */
export const sessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean().optional(),
  image: z.string().nullable().optional(),
  role: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  mustChangePassword: z.boolean().nullable().optional(),
  lastLoginAt: z.union([z.date(), z.string()]).nullable().optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

export const sessionOutput = z
  .object({
    user: sessionUserSchema,
    expiresAt: z.date().nullable(),
  })
  .nullable();

export const signInOutput = z.object({
  user: sessionUserSchema,
  mustChangePassword: z.boolean(),
});

/** 完整的 `user` 行（`updateProfile` 返回） */
export const userRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: z.string().nullable(),
  role: z.enum(userRoleEnum.enumValues),
  status: z.enum(userStatusEnum.enumValues),
  mustChangePassword: z.boolean(),
  lastLoginAt: z.date().nullable(),
  lastLoginIp: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** 管理员列表 / 新建 / 改状态的返回子集 */
export const adminSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(userRoleEnum.enumValues),
  status: z.enum(userStatusEnum.enumValues),
  mustChangePassword: z.boolean().optional(),
  lastLoginAt: z.date().nullable().optional(),
  createdAt: z.date().optional(),
});
