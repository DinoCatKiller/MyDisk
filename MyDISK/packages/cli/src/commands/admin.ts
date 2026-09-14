import { eq } from "drizzle-orm";
import type { CommandModule } from "yargs";

import { user } from "@MyDISK/db/schema/auth";

import { loadCliEnv } from "../lib/env";
import { makeAuth, makeDb } from "../lib/bootstrap";
import { askPassword, askText, logInfo, logStep, logWarn } from "../lib/prompts";

export type AdminAddArgs = {
  name?: string;
  email?: string;
  password?: string;
};

export async function runAdminAdd(args: AdminAddArgs): Promise<void> {
  const env = loadCliEnv();
  const db = makeDb(env);

  logStep(1, "新增管理员");

  const name = args.name || (await askText("管理员名称"));
  const email = args.email || (await askText("登录邮箱"));

  if (!name || !email) {
    logWarn("名称与邮箱不能为空");
    process.exit(1);
  }

  const duplicated = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  if (duplicated.length > 0) {
    logWarn(`邮箱 ${email} 已存在`);
    process.exit(1);
  }

  let nextPassword = args.password ?? "";
  if (!nextPassword) {
    const first = await askPassword("登录密码（至少 8 位）");
    const second = await askPassword("再次输入密码");
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

  const auth = makeAuth(env, db, true);
  const created = await auth.api.signUpEmail({
    body: { name, email, password: nextPassword },
  });

  await db
    .update(user)
    .set({ role: "admin", status: "active", mustChangePassword: true })
    .where(eq(user.id, created.user.id));

  logInfo(`管理员已创建：${email}`);
  logInfo("对方首次登录后需要修改密码");
}

export async function runAdminList(): Promise<void> {
  const env = loadCliEnv();
  const db = makeDb(env);

  const rows = await db
    .select({
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(user.createdAt);

  if (rows.length === 0) {
    logWarn("暂无管理员，请先执行 ./cli.sh install");
    return;
  }

  console.log("\n管理员列表");
  console.log("========================================");
  for (const row of rows) {
    const tag = row.role === "founder" ? "创始人" : "普通";
    const status = row.status === "active" ? "启用" : "已禁用";
    console.log(`  ${row.email}`);
    console.log(`    名称：${row.name}    角色：${tag}    状态：${status}`);
  }
  console.log("");
}

export async function runAdminRemove(email: string | undefined): Promise<void> {
  const env = loadCliEnv();
  const db = makeDb(env);

  const targetEmail = email || (await askText("要删除的管理员邮箱"));
  if (!targetEmail) {
    logWarn("请提供管理员邮箱");
    process.exit(1);
  }

  const rows = await db
    .select({ id: user.id, role: user.role, email: user.email })
    .from(user)
    .where(eq(user.email, targetEmail))
    .limit(1);

  const target = rows[0];
  if (!target) {
    logWarn(`未找到管理员：${targetEmail}`);
    process.exit(1);
  }
  if (target.role === "founder") {
    logWarn("创始人管理员不可删除");
    process.exit(1);
  }

  await db.delete(user).where(eq(user.id, target.id));
  logInfo(`已删除管理员：${target.email}`);
}

export const adminAddCommand: CommandModule = {
  command: "admin:add",
  describe: "新增管理员",
  builder: (yargsInstance) =>
    yargsInstance
      .option("name", { type: "string", describe: "管理员名称" })
      .option("email", { type: "string", describe: "登录邮箱" })
      .option("password", { type: "string", describe: "登录密码" }),
  handler: async (argv) => {
    await runAdminAdd({
      name: argv.name as string | undefined,
      email: argv.email as string | undefined,
      password: argv.password as string | undefined,
    });
  },
};

export const adminListCommand: CommandModule = {
  command: "admin:list",
  describe: "查看管理员列表",
  handler: async () => {
    await runAdminList();
  },
};

export const adminRemoveCommand: CommandModule = {
  command: "admin:remove",
  describe: "删除管理员（创始人不可删除）",
  builder: (yargsInstance) =>
    yargsInstance.option("email", { type: "string", describe: "要删除的管理员邮箱" }),
  handler: async (argv) => {
    await runAdminRemove(argv.email as string | undefined);
  },
};
