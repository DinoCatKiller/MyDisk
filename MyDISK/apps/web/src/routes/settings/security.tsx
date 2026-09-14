import { useLocation, useNavigate } from "@solidjs/router";
import { Show, createMemo, createSignal } from "solid-js";

import { Protected } from "~/components/layout/protected";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "~/components/ui/card";
import { KeyRoundIcon, ShieldCheckIcon } from "~/components/ui/icons";
import { TextField } from "~/components/ui/input";
import { refreshSession, sessionUser } from "~/lib/session";
import { client } from "~/utils/orpc";

function formatDate(value: string | Date | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

export default function SecuritySettingsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const forced = createMemo(() => location.search.includes("force=1"));

  const [currentPassword, setCurrentPassword] = createSignal("");
  const [newPassword, setNewPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [passwordError, setPasswordError] = createSignal("");
  const [passwordOk, setPasswordOk] = createSignal("");
  const [savingPassword, setSavingPassword] = createSignal(false);

  const [name, setName] = createSignal(sessionUser()?.name ?? "");
  const [profileError, setProfileError] = createSignal("");
  const [profileOk, setProfileOk] = createSignal("");
  const [savingProfile, setSavingProfile] = createSignal(false);

  const handleChangePassword = async (event: Event) => {
    event.preventDefault();
    setPasswordError("");
    setPasswordOk("");

    if (newPassword().length < 8) {
      setPasswordError("新密码至少 8 位");
      return;
    }
    if (newPassword() !== confirmPassword()) {
      setPasswordError("两次输入的新密码不一致");
      return;
    }

    setSavingPassword(true);
    try {
      await client.auth.changePassword({
        currentPassword: currentPassword(),
        newPassword: newPassword(),
      });
      setPasswordOk("密码已更新");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await refreshSession();
      if (forced()) {
        navigate("/files", { replace: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPasswordError(
        /invalid password|不正确/i.test(message) ? "当前密码不正确" : message || "修改失败",
      );
    } finally {
      setSavingPassword(false);
    }
  };

  const handleSaveProfile = async (event: Event) => {
    event.preventDefault();
    setProfileError("");
    setProfileOk("");
    setSavingProfile(true);
    try {
      await client.auth.updateProfile({ name: name().trim() });
      setProfileOk("资料已更新");
      await refreshSession();
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "更新失败");
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <Protected title="账户安全" description="修改密码与个人资料">
      <Show when={forced()}>
        <Alert variant="warning" title="请先修改初始密码" class="mb-5">
          为了账户安全，请设置一个新的密码后继续使用。
        </Alert>
      </Show>

      <div style={{ display: "grid", gap: "16px" }}>
        <Card>
          <CardHeader title="修改密码" description="修改后其它设备的登录会话将失效" />
          <form onSubmit={(event) => void handleChangePassword(event)}>
            <CardBody>
              <Show when={passwordError()}>
                <Alert variant="error" class="mb-4">
                  {passwordError()}
                </Alert>
              </Show>
              <Show when={passwordOk()}>
                <Alert variant="success" class="mb-4">
                  {passwordOk()}
                </Alert>
              </Show>

              <div style={{ display: "grid", gap: "14px", "max-width": "420px" }}>
                <TextField
                  label="当前密码"
                  type="password"
                  autocomplete="current-password"
                  value={currentPassword()}
                  onInput={(event) => setCurrentPassword(event.currentTarget.value)}
                />
                <TextField
                  label="新密码"
                  type="password"
                  autocomplete="new-password"
                  hint="至少 8 位"
                  value={newPassword()}
                  onInput={(event) => setNewPassword(event.currentTarget.value)}
                />
                <TextField
                  label="确认新密码"
                  type="password"
                  autocomplete="new-password"
                  value={confirmPassword()}
                  onInput={(event) => setConfirmPassword(event.currentTarget.value)}
                />
              </div>
            </CardBody>
            <CardFooter>
              <Button
                type="submit"
                variant="primary"
                loading={savingPassword()}
                disabled={!currentPassword() || !newPassword()}
              >
                <KeyRoundIcon size={15} />
                更新密码
              </Button>
            </CardFooter>
          </form>
        </Card>

        <Card>
          <CardHeader title="个人资料" />
          <form onSubmit={(event) => void handleSaveProfile(event)}>
            <CardBody>
              <Show when={profileError()}>
                <Alert variant="error" class="mb-4">
                  {profileError()}
                </Alert>
              </Show>
              <Show when={profileOk()}>
                <Alert variant="success" class="mb-4">
                  {profileOk()}
                </Alert>
              </Show>

              <div style={{ display: "grid", gap: "14px", "max-width": "420px" }}>
                <TextField
                  label="显示名称"
                  value={name()}
                  onInput={(event) => setName(event.currentTarget.value)}
                />
                <TextField label="登录邮箱" value={sessionUser()?.email ?? ""} disabled />
              </div>
            </CardBody>
            <CardFooter>
              <Button type="submit" loading={savingProfile()} disabled={!name().trim()}>
                保存资料
              </Button>
            </CardFooter>
          </form>
        </Card>

        <Card>
          <CardHeader title="账户信息" />
          <CardBody>
            <dl
              style={{
                display: "grid",
                "grid-template-columns": "140px 1fr",
                gap: "10px 16px",
                margin: 0,
                "font-size": "13px",
              }}
            >
              <dt style={{ color: "var(--md-text-muted)" }}>角色</dt>
              <dd style={{ margin: 0, display: "flex", "align-items": "center", gap: "6px" }}>
                <ShieldCheckIcon size={15} />
                {sessionUser()?.role === "founder" ? "创始人管理员" : "普通管理员"}
              </dd>
              <dt style={{ color: "var(--md-text-muted)" }}>上次登录</dt>
              <dd style={{ margin: 0 }}>{formatDate(sessionUser()?.lastLoginAt)}</dd>
              <dt style={{ color: "var(--md-text-muted)" }}>操作</dt>
              <dd style={{ margin: 0 }}>
                <Button size="sm" variant="ghost" onClick={() => void refreshSession()}>
                  刷新会话信息
                </Button>
              </dd>
            </dl>
          </CardBody>
        </Card>
      </div>
    </Protected>
  );
}
