import { eq } from "drizzle-orm";

import { sendMail } from "@MyDISK/mail";
import { createDb, type Database } from "@MyDISK/db";
import { smtpSetting } from "@MyDISK/db/schema";

import type { WorkerEnv } from "../env";
import { decryptSecret } from "@MyDISK/storage";

/** mail 队列（`A1` §4）：读启用的 smtp_setting，解密口令后发信 */
export async function runMail(
  env: WorkerEnv,
  job: { to: string; subject: string; html: string; text?: string },
): Promise<{ messageId: string }> {
  const db: Database = createDb({ DATABASE_URL: env.DATABASE_URL });
  const [setting] = await db
    .select()
    .from(smtpSetting)
    .where(eq(smtpSetting.enabled, true))
    .limit(1);
  if (!setting?.host) {
    throw new Error("SMTP 未配置或未启用，无法发送邮件");
  }
  const password = setting.passEnc ? decryptSecret(setting.passEnc, env.ENCRYPTION_KEY) : null;
  return sendMail(
    {
      host: setting.host,
      port: setting.port ?? 465,
      secure: setting.secure,
      user: setting.user,
      password,
      fromName: setting.fromName,
      fromEmail: setting.fromEmail,
    },
    job,
  );
}
