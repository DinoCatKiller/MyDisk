import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { CommandModule } from "yargs";

import {
  checkDatabase,
  createFounder,
  ensureLocalConnection,
  findFounder,
  makeDb,
  markInstalled,
  pushSchema,
  writeInitialSettings,
} from "../lib/bootstrap";
import { generateCliScripts } from "../lib/cli-sh";
import { loadCliEnv, maskDatabaseUrl } from "../lib/env";
import { DEFAULT_FOUNDER, askPassword, askText, logInfo, logStep, logWarn } from "../lib/prompts";

export type InstallArgs = {
  yes?: boolean;
  name?: string;
  email?: string;
  password?: string;
};

export async function runInstall(args: InstallArgs): Promise<void> {
  const env = loadCliEnv();

  console.log("MyDisk 安装程序");
  console.log("========================================");

  // 第 1 步：生成 cli.sh / cli.ps1
  logStep(1, "生成运维入口脚本");
  const scripts = generateCliScripts(env.projectRoot);
  logInfo(`${scripts.shCreated ? "已生成" : "已存在，跳过"}：cli.sh`);
  logInfo(`${scripts.ps1Created ? "已生成" : "已存在，跳过"}：cli.ps1`);

  // 第 2 步：安装依赖
  logStep(2, "检查依赖");
  if (existsSync(join(env.projectRoot, "node_modules"))) {
    logInfo("node_modules 已存在，跳过 bun install");
  } else {
    logInfo("未检测到依赖，执行 bun install …");
    const install = spawnSync("bun", ["install"], {
      cwd: env.projectRoot,
      stdio: "inherit",
    });
    if (install.status !== 0) {
      logWarn("bun install 失败，请手动执行后重试");
      process.exit(1);
    }
  }

  // 第 3 步：数据库连通性
  logStep(3, "连接数据库");
  logInfo(maskDatabaseUrl(env.DATABASE_URL));
  try {
    await checkDatabase(env);
    logInfo("连接成功");
  } catch (error) {
    logWarn(`数据库连接失败：${(error as Error).message}`);
    logWarn("请确认 PostgreSQL 已启动，且 apps/server/.env 中的 DATABASE_URL 正确");
    process.exit(1);
  }

  // 第 4 步：同步表结构
  logStep(4, "同步数据库表结构");
  const pushed = pushSchema(env);
  if (!pushed.ok) {
    logWarn("drizzle-kit push 失败：");
    console.log(pushed.output);
    logWarn("可稍后手动执行：bun run db:push");
    process.exit(1);
  }
  logInfo("表结构已同步");

  // 第 5 步：创始人管理员
  const db = makeDb(env);
  logStep(5, "设置创始人管理员");

  const existingFounder = await findFounder(db);
  let founderId: string;
  let founderEmail: string;

  if (existingFounder) {
    logInfo(`已存在创始人管理员：${existingFounder.email}，跳过创建`);
    founderId = existingFounder.id;
    founderEmail = existingFounder.email;
  } else {
    let name = args.name ?? "";
    let email = args.email ?? "";
    let passwordValue = args.password ?? "";

    if (!name || !email || !passwordValue) {
      if (args.yes) {
        name = name || DEFAULT_FOUNDER.name;
        email = email || DEFAULT_FOUNDER.email;
        passwordValue = passwordValue || DEFAULT_FOUNDER.password;
      } else {
        logInfo("请设置创始人管理员的登录信息（直接回车使用括号中的默认值）");
        name = name || (await askText("管理员名称", DEFAULT_FOUNDER.name));
        email = email || (await askText("登录邮箱", DEFAULT_FOUNDER.email));
        if (!passwordValue) {
          const first = await askPassword("登录密码（至少 8 位）");
          const second = await askPassword("再次输入密码");
          if (first !== second) {
            logWarn("两次输入的密码不一致");
            process.exit(1);
          }
          passwordValue = first || DEFAULT_FOUNDER.password;
        }
      }
    }

    if (passwordValue.length < 8) {
      logWarn("密码至少 8 位");
      process.exit(1);
    }

    const created = await createFounder(env, db, {
      name,
      email,
      password: passwordValue,
    });
    founderId = created.id;
    founderEmail = created.email;
    logInfo(`创始人管理员已创建：${created.email}`);
    logInfo("首次登录后系统会要求修改密码");
  }

  // 第 6 步：默认存储连接与初始设置
  logStep(6, "初始化默认存储连接");
  const connectionId = await ensureLocalConnection(env, db, founderId);
  await writeInitialSettings(env, db, connectionId);
  logInfo("默认连接：local（<项目根>/storage）");

  const markPath = markInstalled(env);
  logStep(7, "完成");
  logInfo(`安装标记：${markPath}`);
  console.log("\n安装完成。");
  console.log(`  登录邮箱：${founderEmail}`);
  console.log("  启动服务：./cli.sh serve   （或 bun run dev）");
  console.log("  再次配置：./cli.sh\n");
}

export const installCommand: CommandModule = {
  command: "install",
  describe: "安装：生成 cli.sh、安装依赖、建表并创建创始人管理员",
  builder: (yargsInstance) =>
    yargsInstance
      .option("yes", {
        alias: "y",
        type: "boolean",
        default: false,
        describe: "使用默认值非交互执行",
      })
      .option("name", { type: "string", describe: "管理员名称" })
      .option("email", { type: "string", describe: "登录邮箱" })
      .option("password", { type: "string", describe: "登录密码（至少 8 位）" }),
  handler: async (argv) => {
    await runInstall({
      yes: argv.yes as boolean | undefined,
      name: argv.name as string | undefined,
      email: argv.email as string | undefined,
      password: argv.password as string | undefined,
    });
  },
};
