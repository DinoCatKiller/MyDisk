# @MyDISK/mail · SMTP 发信与邮件模板

|        |                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 状态   | ✅ 已落地（P0；尚未接入队列）                                                                                                              |
| 边界   | 负责 nodemailer 传输/发送/连通性校验、内联 HTML 模板；**不含**发信调度（走 `mail` 队列）、SMTP 配置持久化（落 `smtp_setting`，见 `A6` §9） |
| 上游   | `nodemailer`                                                                                                                               |
| 下游   | `@MyDISK/api`（未来）、`apps/worker`（P3，⬜）                                                                                             |
| 何时读 | 改邮件模板 / 发信流程                                                                                                                      |

## 这个 crate 是什么

一个**信封工厂**：只负责把内容折进统一的信封（HTML 外壳）并投递，什么时候发、发给谁由上层决定。

## 核心内容

| 项                                | 说明                                                                     |
| --------------------------------- | ------------------------------------------------------------------------ |
| `SmtpConfig`                      | `host`/`port`/`secure`/`user`/`password`/`fromName`/`fromEmail`          |
| `createTransport(config)`         | 建 nodemailer transport；`secure` 缺省按端口 465 判定                    |
| `sendMail(config, options)`       | 发送并返回 `messageId`；`SendMailOptions = { to, subject, html, text? }` |
| `verifyTransport(config)`         | 连通性自检，供 `smtp:test`（P4，⬜）用                                   |
| `passwordResetTemplate(link)`     | 重置密码邮件（链接 30 分钟有效）                                         |
| `emailVerificationTemplate(code)` | 邮箱验证码（10 分钟有效）                                                |
| `passwordChangedTemplate()`       | 改密通知                                                                 |
| `wrap(title, body, siteName)`     | 统一 HTML 外壳，三个模板共用                                             |

## 必须知道的三个设计决定

1. **每次发送新建 transport**：`createTransport` 无状态，便于同一进程按不同 SMTP 配置发信；代价是不复用连接池——吞吐由 `mail` 队列（并发 8）兜底。
2. **SMTP 密码加密落库**：明文密码不入库、不出接口，仅运行时解密（`A4` 的 `encryptSecret`）。
3. **发信不在请求线程同步执行**：重置密码、验证码等由 `mail` 队列异步发，避免请求被 SMTP 阻塞（`A1` §4）。

## 相关

- `A6` §9（邮件与 SMTP 规则）｜ `A1` §4（`mail` 队列）｜ `A4`（密钥加密）
- 地图 → `AGENTS.md` §2
