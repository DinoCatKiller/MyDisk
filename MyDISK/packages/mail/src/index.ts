import nodemailer, { type Transporter } from "nodemailer";

export type SmtpConfig = {
  host: string;
  port: number;
  secure?: boolean;
  user?: string | null;
  password?: string | null;
  fromName?: string | null;
  fromEmail?: string | null;
};

export type SendMailOptions = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export function createTransport(config: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure ?? config.port === 465,
    auth: config.user && config.password ? { user: config.user, pass: config.password } : undefined,
  });
}

function formatFrom(config: SmtpConfig): string {
  const email = config.fromEmail ?? config.user ?? "";
  return config.fromName ? `"${config.fromName}" <${email}>` : email;
}

export async function sendMail(
  config: SmtpConfig,
  options: SendMailOptions,
): Promise<{ messageId: string }> {
  const transport = createTransport(config);
  const info = await transport.sendMail({
    from: formatFrom(config),
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });
  return { messageId: info.messageId };
}

export async function verifyTransport(config: SmtpConfig): Promise<boolean> {
  const transport = createTransport(config);
  await transport.verify();
  return true;
}

export type MailTemplate = {
  subject: string;
  html: string;
  text: string;
};

function wrap(title: string, body: string, siteName: string): string {
  return `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;background:#f5f6f8;font-family:Inter,'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px">
      <div style="background:#fff;border-radius:14px;padding:28px 24px;box-shadow:0 8px 24px rgba(15,23,42,.06)">
        <h1 style="margin:0 0 16px;font-size:18px;color:#0f172a">${title}</h1>
        <div style="font-size:14px;line-height:1.7;color:#334155">${body}</div>
      </div>
      <p style="margin:16px 0 0;text-align:center;font-size:12px;color:#94a3b8">${siteName}</p>
    </div>
  </body>
</html>`;
}

export function passwordResetTemplate(link: string, siteName = "MyDisk"): MailTemplate {
  return {
    subject: `【${siteName}】重置你的登录密码`,
    html: wrap(
      "重置登录密码",
      `<p>我们收到了你的密码重置请求，点击下面的按钮设置新密码：</p>
       <p style="margin:22px 0">
         <a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:11px 22px;border-radius:10px">重置密码</a>
       </p>
       <p style="color:#64748b">链接 30 分钟内有效。如果这不是你本人的操作，请忽略本邮件。</p>
       <p style="color:#94a3b8;word-break:break-all;font-size:12px">${link}</p>`,
      siteName,
    ),
    text: `重置登录密码：${link}（30 分钟内有效）`,
  };
}

export function emailVerificationTemplate(code: string, siteName = "MyDisk"): MailTemplate {
  return {
    subject: `【${siteName}】邮箱验证码`,
    html: wrap(
      "邮箱验证码",
      `<p>你的验证码是：</p>
       <p style="margin:18px 0;font-size:28px;letter-spacing:6px;font-weight:600;color:#0f172a">${code}</p>
       <p style="color:#64748b">10 分钟内有效，请勿转发给他人。</p>`,
      siteName,
    ),
    text: `邮箱验证码：${code}（10 分钟内有效）`,
  };
}

export function passwordChangedTemplate(siteName = "MyDisk"): MailTemplate {
  return {
    subject: `【${siteName}】密码已修改`,
    html: wrap(
      "密码已修改",
      `<p>你的账户密码刚刚被修改。如果这不是你本人的操作，请立即联系站点负责人。</p>`,
      siteName,
    ),
    text: "你的账户密码刚刚被修改。",
  };
}
