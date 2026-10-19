import { createFileRoute, useRouter } from "@tanstack/solid-router";
import { For, Show, createSignal } from "solid-js";

import { MIN_PASSWORD_LENGTH } from "@MyDISK/auth/password";

import { Protected } from "~/components/layout/protected";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "~/components/ui/card";
import { RefreshIcon, UserPlusIcon } from "~/components/ui/icons";
import { TextField } from "~/components/ui/input";
import { useIsFounder, type RouterContext } from "~/lib/session";
import { fetchAdmins } from "~/server/fns";
import { client } from "~/utils/orpc";

type AdminRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: Date | string | null;
  createdAt: Date | string;
};

function formatDate(value: Date | string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

export const Route = createFileRoute("/admin/users")({
  // 仅创始人装载列表；其它角色返回空数组，由组件展示权限提示（`D8` loader 取数）
  loader: async ({ context }): Promise<AdminRow[]> => {
    if ((context as RouterContext).session?.role !== "founder") {
      return [];
    }
    return (await fetchAdmins()) as unknown as AdminRow[];
  },
  component: AdminUsersPage,
});

function AdminUsersPage() {
  const router = useRouter();
  const isFounder = useIsFounder();
  const admins = Route.useLoaderData();

  const [error, setError] = createSignal("");
  const [notice, setNotice] = createSignal("");

  const [name, setName] = createSignal("");
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [creating, setCreating] = createSignal(false);

  /** 重新装载列表：让根路由 beforeLoad 与 loader 再跑一次（`D8`） */
  const reload = () => router.invalidate();

  const handleCreate = async (event: Event) => {
    event.preventDefault();
    setError("");
    setNotice("");

    if (password().length < MIN_PASSWORD_LENGTH) {
      setError(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
      return;
    }

    setCreating(true);
    try {
      await client.auth.createAdmin({
        name: name().trim(),
        email: email().trim(),
        password: password(),
      });
      setNotice(`已创建管理员 ${email().trim()}`);
      setName("");
      setEmail("");
      setPassword("");
      await reload();
    } catch (createError) {
      const message = createError instanceof Error ? createError.message : "创建失败";
      setError(/CONFLICT|已存在/.test(message) ? "该邮箱已存在" : message);
    } finally {
      setCreating(false);
    }
  };

  const handleRemove = async (row: AdminRow) => {
    setError("");
    setNotice("");
    try {
      await client.auth.deleteAdmin({ userId: row.id });
      setNotice(`已删除 ${row.email}`);
      await reload();
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : "删除失败";
      setError(/founder|创始人/.test(message) ? "创始人管理员不可删除" : message);
    }
  };

  const handleToggleStatus = async (row: AdminRow) => {
    setError("");
    setNotice("");
    try {
      await client.auth.setAdminStatus({
        userId: row.id,
        status: row.status === "active" ? "disabled" : "active",
      });
      await reload();
    } catch (statusError) {
      const message = statusError instanceof Error ? statusError.message : "操作失败";
      setError(/founder|创始人/.test(message) ? "创始人管理员不可被禁用" : message);
    }
  };

  return (
    <Protected title="管理员" description="创始人可新增、删除、启用或禁用管理员">
      <Show
        when={isFounder()}
        fallback={
          <Alert variant="warning" title="权限不足">
            仅创始人管理员可以管理账户。
          </Alert>
        }
      >
        <div style={{ display: "grid", gap: "16px" }}>
          <Show when={error()}>
            <Alert variant="error">{error()}</Alert>
          </Show>
          <Show when={notice()}>
            <Alert variant="success">{notice()}</Alert>
          </Show>

          <Card>
            <CardHeader
              title="管理员列表"
              description={`共 ${admins().length} 个账户`}
              action={
                <Button size="sm" variant="ghost" onClick={() => void reload()}>
                  <RefreshIcon size={14} />
                  刷新
                </Button>
              }
            />
            <CardBody>
              <table style={{ width: "100%", "border-collapse": "collapse", "font-size": "13px" }}>
                <thead>
                  <tr style={{ "text-align": "left", color: "var(--md-text-muted)" }}>
                    <th style={{ padding: "8px 10px", "font-weight": 500 }}>账户</th>
                    <th style={{ padding: "8px 10px", "font-weight": 500 }}>角色</th>
                    <th style={{ padding: "8px 10px", "font-weight": 500 }}>状态</th>
                    <th style={{ padding: "8px 10px", "font-weight": 500 }}>上次登录</th>
                    <th style={{ padding: "8px 10px", "font-weight": 500, "text-align": "right" }}>
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <For each={admins()}>
                    {(row) => (
                      <tr style={{ "border-top": "1px solid var(--md-border)" }}>
                        <td style={{ padding: "10px" }}>
                          <div style={{ "font-weight": 500 }}>{row.name}</div>
                          <div style={{ color: "var(--md-text-muted)", "font-size": "12px" }}>
                            {row.email}
                          </div>
                        </td>
                        <td style={{ padding: "10px" }}>
                          {row.role === "founder" ? "创始人" : "普通管理员"}
                        </td>
                        <td style={{ padding: "10px" }}>
                          {row.status === "active" ? "启用" : "已禁用"}
                          <Show when={row.mustChangePassword}>
                            <span style={{ color: "var(--md-warning)", "font-size": "12px" }}>
                              {" "}
                              · 待改密
                            </span>
                          </Show>
                        </td>
                        <td style={{ padding: "10px", color: "var(--md-text-soft)" }}>
                          {formatDate(row.lastLoginAt)}
                        </td>
                        <td style={{ padding: "10px", "text-align": "right" }}>
                          <Show when={row.role !== "founder"}>
                            <div
                              style={{
                                display: "inline-flex",
                                gap: "8px",
                                "justify-content": "flex-end",
                              }}
                            >
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void handleToggleStatus(row)}
                              >
                                {row.status === "active" ? "禁用" : "启用"}
                              </Button>
                              <Button
                                size="sm"
                                variant="dangerGhost"
                                onClick={() => void handleRemove(row)}
                              >
                                删除
                              </Button>
                            </div>
                          </Show>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="新增管理员" description="新账户首次登录需要修改密码" />
            <form onSubmit={(event) => void handleCreate(event)}>
              <CardBody>
                <div style={{ display: "grid", gap: "14px", "max-width": "420px" }}>
                  <TextField
                    label="名称"
                    value={name()}
                    onInput={(event) => setName(event.currentTarget.value)}
                  />
                  <TextField
                    label="登录邮箱"
                    type="email"
                    value={email()}
                    onInput={(event) => setEmail(event.currentTarget.value)}
                  />
                  <TextField
                    label="初始密码"
                    type="password"
                    hint={`至少 ${MIN_PASSWORD_LENGTH} 位`}
                    value={password()}
                    onInput={(event) => setPassword(event.currentTarget.value)}
                  />
                </div>
              </CardBody>
              <CardFooter>
                <Button
                  type="submit"
                  variant="primary"
                  loading={creating()}
                  disabled={!name().trim() || !email().trim() || !password()}
                >
                  <UserPlusIcon size={15} />
                  创建管理员
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      </Show>
    </Protected>
  );
}
