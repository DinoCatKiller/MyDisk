import { cancel, confirm, isCancel, password, select, text } from "@clack/prompts";

/** 安装时的默认创始人凭据 */
export const DEFAULT_FOUNDER = {
  name: "pincman",
  email: "pincman1988@gmail.com",
  password: "12345678",
};

export function logStep(index: number, title: string): void {
  console.log(`\n[${index}] ${title}`);
}

export function logInfo(message: string): void {
  console.log(`    ${message}`);
}

export function logWarn(message: string): void {
  console.log(`    ! ${message}`);
}

function exitOnCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel("已取消操作");
    process.exit(0);
  }
  return value as T;
}

export async function askText(message: string, defaultValue?: string): Promise<string> {
  const answer = await text({
    message,
    ...(defaultValue === undefined ? {} : { defaultValue }),
  });
  const value = exitOnCancel(answer);
  return String(value ?? "").trim() || (defaultValue ?? "");
}

export async function askPassword(message: string, fallback?: string): Promise<string> {
  const answer = await password({ message });
  const value = exitOnCancel(answer);
  const result = String(value ?? "");
  return result || (fallback ?? "");
}

export async function askConfirm(message: string, initialValue = true): Promise<boolean> {
  const answer = await confirm({ message, initialValue });
  return exitOnCancel(answer) as boolean;
}

export type MainMenuAction =
  | "install"
  | "passwd"
  | "admin:add"
  | "admin:list"
  | "db:push"
  | "serve"
  | "exit";

export async function pickMainMenuAction(): Promise<MainMenuAction> {
  const answer = await select({
    message: "请选择要执行的操作",
    options: [
      { value: "install", label: "安装 / 重新初始化", hint: "生成 cli.sh、建表、创建创始人管理员" },
      { value: "passwd", label: "修改管理员密码" },
      { value: "admin:add", label: "新增管理员" },
      { value: "admin:list", label: "查看管理员列表" },
      { value: "db:push", label: "同步数据库表结构" },
      { value: "serve", label: "启动开发服务" },
      { value: "exit", label: "退出" },
    ],
  });
  return exitOnCancel(answer) as MainMenuAction;
}
