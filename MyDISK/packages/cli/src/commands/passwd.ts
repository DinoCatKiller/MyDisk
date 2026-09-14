import { cancel, isCancel, text as promptText } from "@clack/prompts";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import type { CommandModule } from "yargs";

import { account, user } from "@MyDISK/db/schema/auth";

import { loadCliEnv } from "../lib/env";
import { makeDb } from "../lib/bootstrap";
import { askPassword, logInfo, logStep, logWarn } from "../lib/prompts";

export type PasswdArgs = {
  email?: string;
  password?: string;
};

async function askNumber(message: string, fallback: number): Promise<number> {
  const answer = await promptText({ message, defaultValue: String(fallback) });
  if (isCancel(answer)) {
    cancel("已取消操作");
    process.exit(0);
  }
  const parsed = Number.parseInt(String(answer), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function runPasswd(args: PasswdArgs): Promise<void> {
  const env = loadCliEnv();
  const db = makeDb(env);

  const admins = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    })
    .from(user)
    .orderBy(user.createdAt);

  if (admins.length === 0) {
    logWarn("系统中还没有管理员，请先执行 ./cli.sh install");
    process.exit(1);
  }

  logStep(1, "选择要修改密码的管理员");

  let target = args.email ? admins.find((item) => item.email === args.email) : undefined;

  if (!target) {
    if (args.email) {
      logWarn(`未找到邮箱为 ${args.email} 的管理员`);
      process.exit(1);
    }
    console.log("    可用管理员：");
    admins.forEach((item, index) => {
      const suffix = item.role === "founder" ? " · 创始人" : "";
      console.log(`      ${index + 1}. ${item.email}（${item.name}${suffix}）`);
    });
    const index = await askNumber("请输入序号", 1);
    target = admins[index - 1];
  }

  if (!target) {
    logWarn("未选择有效管理员");
    process.exit(1);
  }

  logStep(2, `设置 ${target.email} 的新密码`);

  let nextPassword = args.password ?? "";
  if (!nextPassword) {
    const first = await askPassword("新密码（至少 8 位）");
    const second = await askPassword("再次输入新密码");
    if (first !== second) {
      logWarn("两次输入的密码不一致");
      process.exit(1);
    }
    nextPassword = first;
  }

  if (nextPassword.length < 8) {
    logWarn("密码至少 8 位");
    process.exit(1);
  }

  const hashed = await hashPassword(nextPassword);
  const updated = await db
    .update(account)
    .set({ password: hashed, updatedAt: new Date() })
    .where(and(eq(account.userId, target.id), eq(account.providerId, "credential")))
    .returning({ id: account.id });

  if (updated.length === 0) {
    logWarn("该账户没有密码凭据，无法直接修改密码");
    process.exit(1);
  }

  await db.update(user).set({ mustChangePassword: false }).where(eq(user.id, target.id));

  logInfo(`已更新 ${target.email} 的密码`);
  logInfo("提示：该账户已登录的会话不会自动失效");
}

export const passwdCommand: CommandModule = {
  command: "passwd",
  describe: "修改管理员密码",
  builder: (yargsInstance) =>
    yargsInstance
      .option("email", { type: "string", describe: "目标管理员邮箱" })
      .option("password", { type: "string", describe: "新密码（至少 8 位）" }),
  handler: async (argv) => {
    await runPasswd({
      email: argv.email as string | undefined,
      password: argv.password as string | undefined,
    });
  },
};
