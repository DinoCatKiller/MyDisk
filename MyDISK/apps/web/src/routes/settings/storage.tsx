import { createFileRoute } from "@tanstack/solid-router";
import { For, Show, createMemo, createSignal, onSettled } from "solid-js";

import type { ConnectionCreateInput } from "@MyDISK/api/schemas/connection";

import { Protected } from "~/components/layout/protected";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "~/components/ui/card";
import { HardDriveIcon, PencilIcon, PlusIcon, RefreshIcon, TrashIcon } from "~/components/ui/icons";
import { TextField } from "~/components/ui/input";
import { useIsFounder } from "~/lib/session";
import { client } from "~/utils/orpc";

type PublicConnection = Awaited<ReturnType<typeof client.connection.list>>[number];
type ConnectionType = "local" | "cos" | "oss" | "s3";

const TYPE_LABELS: Record<ConnectionType, string> = {
  local: "本地",
  cos: "腾讯云 COS",
  oss: "阿里云 OSS",
  s3: "S3 兼容",
};

const CREDENTIAL_LABELS: Record<Exclude<ConnectionType, "local">, [string, string]> = {
  cos: ["SecretId", "SecretKey"],
  oss: ["AccessKeyId", "AccessKeySecret"],
  s3: ["AccessKeyId", "SecretAccessKey"],
};

function credentialLabelsOf(type: ConnectionType): [string, string] | null {
  return type === "local" ? null : CREDENTIAL_LABELS[type];
}

const inputStyle = {
  width: "100%",
  "box-sizing": "border-box",
  padding: "8px 10px",
  "border-radius": "8px",
  border: "1px solid var(--md-border)",
  background: "var(--md-surface)",
  color: "var(--md-text)",
  "font-size": "13px",
} as const;

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { hour12: false });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const Route = createFileRoute("/settings/storage")({
  component: StorageSettingsPage,
});

function StorageSettingsPage() {
  const founder = useIsFounder();

  const [connections, setConnections] = createSignal<PublicConnection[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [pageError, setPageError] = createSignal("");
  const [notice, setNotice] = createSignal("");

  const [testLoading, setTestLoading] = createSignal<string | null>(null);
  const [testResults, setTestResults] = createSignal<Record<string, { ok: boolean; text: string }>>(
    {},
  );

  // 新建表单
  const [createOpen, setCreateOpen] = createSignal(false);
  const [createType, setCreateType] = createSignal<ConnectionType>("s3");
  const [createName, setCreateName] = createSignal("");
  const [createBucket, setCreateBucket] = createSignal("");
  const [createRegion, setCreateRegion] = createSignal("");
  const [createEndpoint, setCreateEndpoint] = createSignal("");
  const [createRootPrefix, setCreateRootPrefix] = createSignal("");
  const [createKeyA, setCreateKeyA] = createSignal("");
  const [createKeyB, setCreateKeyB] = createSignal("");
  const [createError, setCreateError] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [draftTesting, setDraftTesting] = createSignal(false);
  const [draftTest, setDraftTest] = createSignal("");

  // 编辑表单
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editName, setEditName] = createSignal("");
  const [editBucket, setEditBucket] = createSignal("");
  const [editRegion, setEditRegion] = createSignal("");
  const [editEndpoint, setEditEndpoint] = createSignal("");
  const [editRootPrefix, setEditRootPrefix] = createSignal("");
  const [editKeyA, setEditKeyA] = createSignal("");
  const [editKeyB, setEditKeyB] = createSignal("");
  const [editError, setEditError] = createSignal("");
  const [editSaving, setEditSaving] = createSignal(false);

  const editingRow = createMemo(() => connections().find((row) => row.id === editingId()) ?? null);

  const load = async () => {
    try {
      const rows = await client.connection.list();
      setConnections(rows);
      setPageError("");
    } catch (error) {
      setPageError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  onSettled(() => {
    void load();
  });

  const buildDraft = (): ConnectionCreateInput => {
    const base = {
      name: createName().trim(),
      type: createType(),
      rootPrefix: createRootPrefix().trim(),
    };
    switch (createType()) {
      case "local":
        return { ...base, type: "local" };
      case "cos":
        return {
          ...base,
          type: "cos",
          bucket: createBucket().trim(),
          region: createRegion().trim(),
          endpoint: createEndpoint().trim() || undefined,
          config: { secretId: createKeyA().trim(), secretKey: createKeyB().trim() },
        };
      case "oss":
        return {
          ...base,
          type: "oss",
          bucket: createBucket().trim(),
          region: createRegion().trim(),
          endpoint: createEndpoint().trim() || undefined,
          config: { accessKeyId: createKeyA().trim(), accessKeySecret: createKeyB().trim() },
        };
      case "s3":
        return {
          ...base,
          type: "s3",
          bucket: createBucket().trim(),
          region: createRegion().trim() || undefined,
          endpoint: createEndpoint().trim() || undefined,
          config: { accessKeyId: createKeyA().trim(), secretAccessKey: createKeyB().trim() },
        };
    }
  };

  const handleDraftTest = async () => {
    setDraftTest("");
    setDraftTesting(true);
    try {
      const result = await client.connection.test({ draft: buildDraft() });
      setDraftTest(
        result.ok
          ? `连通正常（${result.latencyMs} ms）`
          : `连通失败（${result.latencyMs} ms）：${result.error ?? "未知错误"}`,
      );
    } catch (error) {
      setDraftTest(`测试失败：${errorMessage(error)}`);
    } finally {
      setDraftTesting(false);
    }
  };

  const handleCreate = async (event: Event) => {
    event.preventDefault();
    setCreateError("");
    setNotice("");
    setSaving(true);
    try {
      await client.connection.create(buildDraft());
      setNotice(`已创建连接「${createName().trim()}」`);
      setCreateName("");
      setCreateBucket("");
      setCreateRegion("");
      setCreateEndpoint("");
      setCreateRootPrefix("");
      setCreateKeyA("");
      setCreateKeyB("");
      setDraftTest("");
      setCreateOpen(false);
      await load();
    } catch (error) {
      setCreateError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (row: PublicConnection) => {
    setTestLoading(row.id);
    try {
      const result = await client.connection.test({ id: row.id });
      setTestResults((prev) => ({
        ...prev,
        [row.id]: {
          ok: result.ok,
          text: result.ok
            ? `连通正常（${result.latencyMs} ms）`
            : `连通失败（${result.latencyMs} ms）：${result.error ?? "未知错误"}`,
        },
      }));
    } catch (error) {
      setTestResults((prev) => ({
        ...prev,
        [row.id]: { ok: false, text: errorMessage(error) },
      }));
    } finally {
      setTestLoading(null);
    }
  };

  const handleSetDefault = async (row: PublicConnection) => {
    setPageError("");
    setNotice("");
    try {
      await client.connection.setDefault({ id: row.id, sync: "skip" });
      setNotice(`已将「${row.name}」设为默认连接`);
      await load();
    } catch (error) {
      setPageError(errorMessage(error));
    }
  };

  const handleDelete = async (row: PublicConnection) => {
    if (
      !window.confirm(
        `确定删除连接「${row.name}」？该操作不可撤销；连接下必须没有文件（含回收站）。`,
      )
    ) {
      return;
    }
    setPageError("");
    setNotice("");
    try {
      await client.connection.delete({ id: row.id });
      setNotice(`已删除连接「${row.name}」`);
      await load();
    } catch (error) {
      setPageError(errorMessage(error));
    }
  };

  const startEdit = (row: PublicConnection) => {
    setEditingId(row.id);
    setEditName(row.name);
    setEditBucket(row.bucket ?? "");
    setEditRegion(row.region ?? "");
    setEditEndpoint(row.endpoint ?? "");
    setEditRootPrefix(row.rootPrefix);
    setEditKeyA("");
    setEditKeyB("");
    setEditError("");
  };

  const handleEdit = async (event: Event) => {
    event.preventDefault();
    const row = editingRow();
    if (!row) {
      return;
    }
    setEditError("");
    setEditSaving(true);
    try {
      const isLocal = row.type === "local";
      const config =
        !isLocal && editKeyA().trim() && editKeyB().trim()
          ? row.type === "cos"
            ? { secretId: editKeyA().trim(), secretKey: editKeyB().trim() }
            : row.type === "oss"
              ? { accessKeyId: editKeyA().trim(), accessKeySecret: editKeyB().trim() }
              : { accessKeyId: editKeyA().trim(), secretAccessKey: editKeyB().trim() }
          : undefined;

      await client.connection.update({
        id: row.id,
        name: editName().trim() || undefined,
        bucket: isLocal ? undefined : editBucket().trim(),
        region: isLocal ? undefined : editRegion().trim(),
        endpoint: isLocal ? undefined : editEndpoint().trim(),
        rootPrefix: editRootPrefix().trim(),
        config,
      });
      setNotice(`已更新连接「${editName().trim()}」`);
      setEditingId(null);
      await load();
    } catch (error) {
      setEditError(errorMessage(error));
    } finally {
      setEditSaving(false);
    }
  };

  const credentialLabels = createMemo(() => credentialLabelsOf(createType()));

  return (
    <Protected title="存储连接" description="本地 / 腾讯云 COS / 阿里云 OSS / S3">
      <div style={{ display: "grid", gap: "16px" }}>
        <Show when={pageError()}>
          <Alert variant="error">{pageError()}</Alert>
        </Show>
        <Show when={notice()}>
          <Alert variant="success">{notice()}</Alert>
        </Show>

        <Card>
          <CardHeader
            title="连接列表"
            description="一个类型可创建多个连接；本地连接全库唯一"
            action={
              <div style={{ display: "flex", gap: "8px" }}>
                <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading()}>
                  <RefreshIcon size={14} />
                  刷新
                </Button>
                <Show when={founder()}>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => setCreateOpen((open) => !open)}
                  >
                    <PlusIcon size={14} />
                    新建连接
                  </Button>
                </Show>
              </div>
            }
          />
          <CardBody>
            <Show when={loading()}>
              <p style={{ margin: 0, color: "var(--md-text-muted)", "font-size": "13px" }}>
                正在加载连接…
              </p>
            </Show>

            <Show when={!loading() && connections().length === 0}>
              <p style={{ margin: 0, color: "var(--md-text-muted)", "font-size": "13px" }}>
                尚未配置任何存储连接。
              </p>
            </Show>

            <div style={{ display: "grid", gap: "12px" }}>
              <For each={connections()}>
                {(row) => (
                  <div
                    style={{
                      border: "1px solid var(--md-border)",
                      "border-radius": "10px",
                      padding: "14px",
                      display: "grid",
                      gap: "10px",
                      background: "var(--md-surface)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        "align-items": "center",
                        "justify-content": "space-between",
                        gap: "12px",
                        "flex-wrap": "wrap",
                      }}
                    >
                      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                        <HardDriveIcon size={16} />
                        <strong style={{ "font-size": "14px" }}>{row.name}</strong>
                        <span
                          style={{
                            "font-size": "12px",
                            color: "var(--md-text-muted)",
                            border: "1px solid var(--md-border)",
                            "border-radius": "999px",
                            padding: "1px 8px",
                          }}
                        >
                          {TYPE_LABELS[row.type]}
                        </span>
                        <Show when={row.isDefault}>
                          <span
                            style={{
                              "font-size": "12px",
                              "border-radius": "999px",
                              padding: "1px 8px",
                              background: "var(--md-accent-soft, #e8f0fe)",
                              color: "var(--md-accent, #2563eb)",
                            }}
                          >
                            默认
                          </span>
                        </Show>
                      </div>

                      <Show when={founder()}>
                        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={testLoading() === row.id}
                            onClick={() => void handleTest(row)}
                          >
                            测连通
                          </Button>
                          <Show when={!row.isDefault}>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void handleSetDefault(row)}
                            >
                              设为默认
                            </Button>
                          </Show>
                          <Button size="sm" variant="ghost" onClick={() => startEdit(row)}>
                            <PencilIcon size={14} />
                            编辑
                          </Button>
                          <Button
                            size="sm"
                            variant="dangerGhost"
                            disabled={row.isDefault || row.fileCount > 0}
                            title={
                              row.isDefault
                                ? "默认连接不可删除"
                                : row.fileCount > 0
                                  ? "请先清空该连接下的文件"
                                  : undefined
                            }
                            onClick={() => void handleDelete(row)}
                          >
                            <TrashIcon size={14} />
                            删除
                          </Button>
                        </div>
                      </Show>
                    </div>

                    <dl
                      style={{
                        display: "grid",
                        "grid-template-columns": "repeat(auto-fit, minmax(150px, 1fr))",
                        gap: "6px 16px",
                        margin: 0,
                        "font-size": "12px",
                      }}
                    >
                      <div>
                        <dt style={{ color: "var(--md-text-muted)" }}>状态</dt>
                        <dd
                          style={{
                            margin: 0,
                            color: row.status === "active" ? "#15803d" : "#b91c1c",
                          }}
                        >
                          {row.status === "active" ? "正常" : "异常"}
                        </dd>
                      </div>
                      <div>
                        <dt style={{ color: "var(--md-text-muted)" }}>文件 / 容量</dt>
                        <dd style={{ margin: 0 }}>
                          {row.fileCount} 个 · {formatSize(row.totalSize)}
                        </dd>
                      </div>
                      <div>
                        <dt style={{ color: "var(--md-text-muted)" }}>Bucket / Region</dt>
                        <dd style={{ margin: 0 }}>
                          {row.bucket ?? "—"} / {row.region ?? "—"}
                        </dd>
                      </div>
                      <div>
                        <dt style={{ color: "var(--md-text-muted)" }}>Endpoint</dt>
                        <dd style={{ margin: 0 }}>{row.endpoint ?? "—"}</dd>
                      </div>
                      <div>
                        <dt style={{ color: "var(--md-text-muted)" }}>根前缀</dt>
                        <dd style={{ margin: 0 }}>{row.rootPrefix || "—"}</dd>
                      </div>
                      <div>
                        <dt style={{ color: "var(--md-text-muted)" }}>密钥（脱敏）</dt>
                        <dd style={{ margin: 0 }}>
                          <Show
                            when={Object.entries(row.configMasked).length > 0}
                            fallback={<span>—</span>}
                          >
                            <For each={Object.entries(row.configMasked)}>
                              {([key, value]) => <span>{`${key}: ${value} `}</span>}
                            </For>
                          </Show>
                        </dd>
                      </div>
                      <div>
                        <dt style={{ color: "var(--md-text-muted)" }}>最近更新</dt>
                        <dd style={{ margin: 0 }}>{formatDate(row.updatedAt)}</dd>
                      </div>
                    </dl>

                    <Show when={row.lastError}>
                      <Alert variant="error">{row.lastError}</Alert>
                    </Show>

                    <Show when={testResults()[row.id]}>
                      <Alert variant={testResults()[row.id]?.ok ? "success" : "error"}>
                        {testResults()[row.id]?.text}
                      </Alert>
                    </Show>

                    <Show when={editingId() === row.id}>
                      <form onSubmit={(event) => void handleEdit(event)}>
                        <div
                          style={{
                            display: "grid",
                            gap: "12px",
                            "grid-template-columns": "repeat(auto-fit, minmax(200px, 1fr))",
                            "border-top": "1px dashed var(--md-border)",
                            "padding-top": "12px",
                          }}
                        >
                          <TextField
                            label="名称"
                            value={editName()}
                            onInput={(event) => setEditName(event.currentTarget.value)}
                          />
                          <Show when={row.type !== "local"}>
                            <TextField
                              label="Bucket"
                              value={editBucket()}
                              onInput={(event) => setEditBucket(event.currentTarget.value)}
                            />
                            <TextField
                              label="Region"
                              hint={row.type === "s3" ? "可留空" : undefined}
                              value={editRegion()}
                              onInput={(event) => setEditRegion(event.currentTarget.value)}
                            />
                            <TextField
                              label="Endpoint"
                              value={editEndpoint()}
                              onInput={(event) => setEditEndpoint(event.currentTarget.value)}
                            />
                          </Show>
                          <TextField
                            label="根前缀"
                            value={editRootPrefix()}
                            onInput={(event) => setEditRootPrefix(event.currentTarget.value)}
                          />
                          <Show when={credentialLabelsOf(row.type)}>
                            {(labels) => (
                              <>
                                <TextField
                                  label={`${labels()[0]}（留空不改）`}
                                  value={editKeyA()}
                                  onInput={(event) => setEditKeyA(event.currentTarget.value)}
                                />
                                <TextField
                                  label={`${labels()[1]}（留空不改）`}
                                  type="password"
                                  value={editKeyB()}
                                  onInput={(event) => setEditKeyB(event.currentTarget.value)}
                                />
                              </>
                            )}
                          </Show>
                        </div>

                        <Show when={editError()}>
                          <Alert variant="error" class="mt-3">
                            {editError()}
                          </Alert>
                        </Show>

                        <div style={{ display: "flex", gap: "8px", "margin-top": "12px" }}>
                          <Button type="submit" variant="primary" size="sm" loading={editSaving()}>
                            保存
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                            取消
                          </Button>
                        </div>
                      </form>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </CardBody>
        </Card>

        <Show when={founder() && createOpen()}>
          <Card>
            <CardHeader
              title="新建连接"
              description="云连接需填写 Bucket 与密钥；本地连接无需密钥"
            />
            <form onSubmit={(event) => void handleCreate(event)}>
              <CardBody>
                <Show when={createError()}>
                  <Alert variant="error" class="mb-4">
                    {createError()}
                  </Alert>
                </Show>

                <div
                  style={{
                    display: "grid",
                    gap: "14px",
                    "grid-template-columns": "repeat(auto-fit, minmax(220px, 1fr))",
                  }}
                >
                  <TextField
                    label="名称"
                    placeholder="例如：本机 S3"
                    value={createName()}
                    onInput={(event) => setCreateName(event.currentTarget.value)}
                  />

                  <label style={{ display: "grid", gap: "6px" }}>
                    <span style={{ "font-size": "13px", color: "var(--md-text-muted)" }}>类型</span>
                    <select
                      style={inputStyle}
                      value={createType()}
                      onChange={(event) =>
                        setCreateType(event.currentTarget.value as ConnectionType)
                      }
                    >
                      <option value="s3">S3 兼容（s3rver / MinIO）</option>
                      <option value="cos">腾讯云 COS</option>
                      <option value="oss">阿里云 OSS</option>
                      <option value="local">本地存储</option>
                    </select>
                  </label>

                  <Show when={createType() !== "local"}>
                    <TextField
                      label="Bucket"
                      placeholder="bucket 名称"
                      value={createBucket()}
                      onInput={(event) => setCreateBucket(event.currentTarget.value)}
                    />
                    <TextField
                      label="Region"
                      hint={createType() === "s3" ? "s3rver/MinIO 可留空" : undefined}
                      placeholder={createType() === "cos" ? "ap-guangzhou" : "oss-cn-hangzhou"}
                      value={createRegion()}
                      onInput={(event) => setCreateRegion(event.currentTarget.value)}
                    />
                    <TextField
                      label="Endpoint"
                      hint={
                        createType() === "s3"
                          ? "填 http://127.0.0.1:9000 即走 path-style"
                          : "可选，留空使用云厂商默认域名"
                      }
                      placeholder="http://127.0.0.1:9000"
                      value={createEndpoint()}
                      onInput={(event) => setCreateEndpoint(event.currentTarget.value)}
                    />
                  </Show>

                  <TextField
                    label="根前缀"
                    hint="可选；文件会落在该前缀下"
                    value={createRootPrefix()}
                    onInput={(event) => setCreateRootPrefix(event.currentTarget.value)}
                  />

                  <Show when={credentialLabels()}>
                    {(labels) => (
                      <>
                        <TextField
                          label={labels()[0]}
                          value={createKeyA()}
                          onInput={(event) => setCreateKeyA(event.currentTarget.value)}
                        />
                        <TextField
                          label={labels()[1]}
                          type="password"
                          value={createKeyB()}
                          onInput={(event) => setCreateKeyB(event.currentTarget.value)}
                        />
                      </>
                    )}
                  </Show>
                </div>

                <Show when={createType() === "local"}>
                  <p
                    style={{
                      margin: "12px 0 0",
                      "font-size": "12px",
                      color: "var(--md-text-muted)",
                    }}
                  >
                    本地连接实际根目录固定为项目根的 storage 目录。
                  </p>
                </Show>

                <Show when={draftTest()}>
                  <Alert
                    variant={draftTest().startsWith("连通正常") ? "success" : "error"}
                    class="mt-4"
                  >
                    {draftTest()}
                  </Alert>
                </Show>
              </CardBody>
              <CardFooter>
                <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={saving()}
                    disabled={!createName().trim()}
                  >
                    保存连接
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={draftTesting()}
                    onClick={() => void handleDraftTest()}
                  >
                    测连通
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setCreateOpen(false)}>
                    取消
                  </Button>
                </div>
              </CardFooter>
            </form>
          </Card>
        </Show>
      </div>
    </Protected>
  );
}
