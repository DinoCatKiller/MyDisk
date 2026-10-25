import { createFileRoute, useNavigate } from "@tanstack/solid-router";
import { For, Show, createSignal } from "solid-js";

import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  CheckIcon,
  FolderTreeIcon,
  HardDriveIcon,
  KeyRoundIcon,
  ShareIcon,
} from "~/components/ui/icons";
import { TextField } from "~/components/ui/input";
import { signIn } from "~/lib/session";

import styles from "./login.module.css";

function translateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid email or password/i.test(message)) {
    return "邮箱或密码不正确";
  }
  if (/disabled|禁用/i.test(message)) {
    return "账户已被禁用，请联系创始人管理员";
  }
  if (/too many|rate/i.test(message)) {
    return "尝试次数过多，请稍后再试";
  }
  if (/failed to fetch|network|无法连接/i.test(message)) {
    return "无法连接服务器，请确认后端已启动";
  }
  return message || "登录失败";
}

const FEATURES = [
  { icon: <HardDriveIcon size={14} />, text: "本地 / 腾讯云 / 阿里云 / S3 多存储统一管理" },
  { icon: <FolderTreeIcon size={14} />, text: "分片上传与断点续传，刷新后继续传" },
  { icon: <ShareIcon size={14} />, text: "文件与文件夹分享，支持密码与有效期" },
  { icon: <KeyRoundIcon size={14} />, text: "创始人 / 管理员分级权限与审计" },
];

export const Route = createFileRoute("/login")({
  // 注意：路由级 head() 在 solid-router rc.9 + solid rc.18 下会使 SSR 抛错
  // （错误被 Errored 吞掉后整页白屏），页面标题暂由根路由 head 承担。
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    if (submitting()) {
      return;
    }
    setError("");

    if (!email().trim() || !password()) {
      setError("请填写邮箱与密码");
      return;
    }

    setSubmitting(true);
    try {
      const result = await signIn({
        email: email().trim(),
        password: password(),
        rememberMe: true,
      });
      // 登录后整页跳转：根路由 beforeLoad 在 SSR 里重新解析会话（`D8`）。
      // 不用 invalidate()+navigate()——两者并发会与 rc.9 的渲染竞态，
      // 出现「URL 已切换、内容停在登录页」的脱节。
      navigate(
        result.mustChangePassword
          ? {
              to: "/settings/security",
              search: { force: true },
              replace: true,
              reloadDocument: true,
            }
          : { to: "/files", replace: true, reloadDocument: true },
      );
    } catch (submitError) {
      setError(translateError(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class={styles.page}>
      <aside class={styles.aside}>
        <div class={styles.brand}>
          <span class={styles.brandMark}>M</span>
          MyDisk
        </div>

        <div>
          <h1 class={styles.headline}>
            你的私人云盘，
            <br />
            数据始终在自己手里
          </h1>
          <p class={styles.subline}>
            单实例自托管，文件落在自己的磁盘或云存储桶中；没有公开注册，只有你与被授权的人可以进入。
          </p>
          <ul class={styles.features}>
            <For each={FEATURES}>
              {(feature) => (
                <li class={styles.feature}>
                  <span class={styles.featureDot}>{feature.icon}</span>
                  {feature.text}
                </li>
              )}
            </For>
          </ul>
        </div>

        <div class={styles.asideFooter}>MyDisk v1.0.0 · 自托管云盘系统</div>
      </aside>

      <main class={styles.main}>
        <form class={styles.form} onSubmit={(event) => void handleSubmit(event)}>
          <h2 class={styles.formTitle}>登录管理后台</h2>
          <p class={styles.formDesc}>使用创始人或管理员邮箱登录</p>

          <Show when={error()}>
            <Alert variant="error" class="mb-4">
              {error()}
            </Alert>
          </Show>

          <div class={styles.fields}>
            <TextField
              label="邮箱"
              name="email"
              type="email"
              placeholder="you@example.com"
              autocomplete="username"
              value={email()}
              onInput={(event) => setEmail(event.currentTarget.value)}
            />
            <TextField
              label="密码"
              name="password"
              type="password"
              placeholder="请输入密码"
              autocomplete="current-password"
              value={password()}
              onInput={(event) => setPassword(event.currentTarget.value)}
            />
          </div>

          <div class={styles.actions}>
            <Button type="submit" variant="primary" block loading={submitting()}>
              <Show when={!submitting()}>
                <CheckIcon size={16} />
              </Show>
              {submitting() ? "登录中…" : "登录"}
            </Button>
          </div>

          <p class={styles.meta}>忘记密码？请联系创始人管理员，或使用 ./cli.sh passwd 重置</p>
        </form>
      </main>
    </div>
  );
}
