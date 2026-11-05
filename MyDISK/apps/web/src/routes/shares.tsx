import { createFileRoute, useRouter } from "@tanstack/solid-router";
import { For, Show, createMemo, createSignal, onSettled } from "solid-js";

import type { FileNode } from "@MyDISK/api/schemas/file";
import type { PublicShare } from "@MyDISK/api/schemas/share";
import { Protected } from "~/components/layout/protected";
import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "~/components/ui/card";
import {
  CheckIcon,
  ExternalLinkIcon,
  FileIcon,
  FolderIcon,
  InfoIcon,
  PencilIcon,
  PlusIcon,
  ShareIcon,
  XIcon,
} from "~/components/ui/icons";
import { TextField } from "~/components/ui/input";
import { formatBytes, formatDateTime } from "~/lib/format";
import { client } from "~/utils/orpc";

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

const mutedStyle = { color: "var(--md-text-muted)", "font-size": "12px" } as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toLocalInput(value: Date | null): string {
  if (!value) {
    return "";
  }
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function statusLabel(share: PublicShare): string {
  if (share.status === "revoked") {
    return "已撤销";
  }
  if (share.status === "expired" || (share.expiresAt && share.expiresAt.getTime() <= Date.now())) {
    return "已过期";
  }
  if (share.maxDownloads !== null && share.downloadCount >= share.maxDownloads) {
    return "次数用尽";
  }
  return "生效中";
}

function shareUrl(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/share/${token}`;
}

export const Route = createFileRoute("/shares")({
  component: SharesPage,
});

function SharesPage() {
  const router = useRouter();

  const [shares, setShares] = createSignal<PublicShare[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [pageError, setPageError] = createSignal("");
  const [notice, setNotice] = createSignal("");

  // 新建
  type PickedNode = Pick<FileNode, "id" | "name" | "type" | "size">;
  const [selectedNode, setSelectedNode] = createSignal<PickedNode | null>(null);
  const [password, setPassword] = createSignal("");
  const [expiresAt, setExpiresAt] = createSignal("");
  const [maxDownloads, setMaxDownloads] = createSignal("");
  const [canPreview, setCanPreview] = createSignal(true);
  const [canDownload, setCanDownload] = createSignal(true);
  const [canList, setCanList] = createSignal(true);
  const [createError, setCreateError] = createSignal("");
  const [creating, setCreating] = createSignal(false);

  // 节点选择器：栈的最后一项即当前所在文件夹，空栈 = 根目录
  const [pickerOpen, setPickerOpen] = createSignal(false);
  const [pickerStack, setPickerStack] = createSignal<{ id: string; name: string }[]>([]);
  const [pickerItems, setPickerItems] = createSignal<FileNode[]>([]);
  const [pickerLoading, setPickerLoading] = createSignal(false);
  const [pickerError, setPickerError] = createSignal("");
  const pickerParent = () => pickerStack().at(-1)?.id ?? null;

  // 编辑
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editPassword, setEditPassword] = createSignal("");
  const [editExpiresAt, setEditExpiresAt] = createSignal("");
  const [editMaxDownloads, setEditMaxDownloads] = createSignal("");
  const [editCanPreview, setEditCanPreview] = createSignal(true);
  const [editCanDownload, setEditCanDownload] = createSignal(true);
  const [editCanList, setEditCanList] = createSignal(true);
  const [editError, setEditError] = createSignal("");
  const [saving, setSaving] = createSignal(false);

  // 访问日志
  const [logShareId, setLogShareId] = createSignal<string | null>(null);
  const [logItems, setLogItems] = createSignal<
    Awaited<ReturnType<typeof client.share.accessLog>>["items"]
  >([]);
  const [logError, setLogError] = createSignal("");
  const [logLoading, setLogLoading] = createSignal(false);

  const editing = createMemo(() => shares().find((row) => row.id === editingId()) ?? null);

  const load = async () => {
    try {
      const page = await client.share.list({ page: 1, pageSize: 100 });
      setShares(page.items);
      setPageError("");
    } catch (error) {
      setPageError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const loadPicker = async (parentId: string | null) => {
    setPickerLoading(true);
    setPickerError("");
    try {
      const page = await client.file.list({
        parentId,
        keyword: null,
        sort: { field: "name", order: "asc" },
        page: 1,
        pageSize: 200,
      });
      setPickerItems(page.items);
    } catch (error) {
      setPickerError(errorMessage(error));
    } finally {
      setPickerLoading(false);
    }
  };

  onSettled(() => {
    void load();
  });

  const resetCreateForm = () => {
    setSelectedNode(null);
    setPassword("");
    setExpiresAt("");
    setMaxDownloads("");
    setCanPreview(true);
    setCanDownload(true);
    setCanList(true);
    setCreateError("");
    setPickerOpen(false);
    setPickerStack([]);
    setPickerItems([]);
  };

  const openPicker = () => {
    setPickerOpen(true);
    setPickerStack([]);
    void loadPicker(null);
  };

  const enterFolder = (node: FileNode) => {
    setPickerStack([...pickerStack(), { id: node.id, name: node.name }]);
    void loadPicker(node.id);
  };

  const backFolder = () => {
    const stack = pickerStack().slice(0, -1);
    setPickerStack(stack);
    void loadPicker(stack.at(-1)?.id ?? null);
  };

  const pickCurrentFolder = () => {
    const current = pickerStack().at(-1);
    if (!current) {
      return;
    }
    setSelectedNode({ id: current.id, name: current.name, type: "folder", size: 0 });
    setPickerOpen(false);
  };

  const createShare = async () => {
    const node = selectedNode();
    if (!node) {
      setCreateError("请先选择要分享的文件或文件夹");
      return;
    }
    const limit = maxDownloads().trim() ? parsePositiveInt(maxDownloads()) : null;
    if (maxDownloads().trim() && limit === null) {
      setCreateError("下载次数上限必须是正整数");
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      const result = await client.share.create({
        nodeId: node.id,
        password: password(),
        expiresAt: expiresAt() ? new Date(expiresAt()) : null,
        maxDownloads: limit,
        canPreview: canPreview(),
        canDownload: canDownload(),
        canList: canList(),
      });
      setNotice(`分享已创建：${shareUrl(result.token)}`);
      resetCreateForm();
      await load();
      await router.invalidate();
    } catch (error) {
      setCreateError(errorMessage(error));
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (row: PublicShare) => {
    setEditingId(row.id);
    setEditPassword("");
    setEditExpiresAt(toLocalInput(row.expiresAt));
    setEditMaxDownloads(row.maxDownloads === null ? "" : String(row.maxDownloads));
    setEditCanPreview(row.canPreview);
    setEditCanDownload(row.canDownload);
    setEditCanList(row.canList);
    setEditError("");
  };

  const saveEdit = async () => {
    const row = editing();
    if (!row) {
      return;
    }
    const limit = editMaxDownloads().trim() ? parsePositiveInt(editMaxDownloads()) : null;
    if (editMaxDownloads().trim() && limit === null) {
      setEditError("下载次数上限必须是正整数");
      return;
    }
    setSaving(true);
    setEditError("");
    try {
      await client.share.update({
        id: row.id,
        password: editPassword().trim() ? editPassword() : undefined,
        expiresAt: editExpiresAt() ? new Date(editExpiresAt()) : null,
        maxDownloads: limit,
        canPreview: editCanPreview(),
        canDownload: editCanDownload(),
        canList: editCanList(),
      });
      setEditingId(null);
      setNotice("分享设置已更新");
      await load();
    } catch (error) {
      setEditError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const revokeShare = async (row: PublicShare) => {
    if (!window.confirm(`撤销分享「${row.nodeName}」？撤销后链接立即失效。`)) {
      return;
    }
    try {
      await client.share.revoke({ id: row.id });
      setNotice("分享已撤销");
      await load();
    } catch (error) {
      setPageError(errorMessage(error));
    }
  };

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      setNotice("链接已复制到剪贴板");
    } catch {
      setNotice(shareUrl(token));
    }
  };

  const toggleLogs = async (row: PublicShare) => {
    if (logShareId() === row.id) {
      setLogShareId(null);
      return;
    }
    setLogShareId(row.id);
    setLogLoading(true);
    setLogError("");
    try {
      const page = await client.share.accessLog({ id: row.id, page: 1, pageSize: 20 });
      setLogItems(page.items);
    } catch (error) {
      setLogError(errorMessage(error));
    } finally {
      setLogLoading(false);
    }
  };

  return (
    <Protected title="分享" description="已创建的分享链接与访问控制">
      <div style={{ display: "grid", gap: "16px" }}>
        <Show when={pageError()}>
          <Alert variant="error" title="加载失败">
            {pageError()}
          </Alert>
        </Show>
        <Show when={notice()}>
          <Alert variant="success" title="操作成功">
            {notice()}
          </Alert>
        </Show>

        <Card>
          <CardHeader
            title="新建分享"
            description="选择文件或文件夹，可设置密码、有效期与下载次数上限"
            action={
              <Button variant={pickerOpen() ? "secondary" : "primary"} onClick={openPicker}>
                <FolderIcon size={15} />
                {selectedNode() ? "重新选择" : "选择文件 / 文件夹"}
              </Button>
            }
          />
          <CardBody>
            <div style={{ display: "grid", gap: "12px" }}>
              <Show when={selectedNode()}>
                {(node) => (
                  <div
                    style={{
                      display: "flex",
                      "align-items": "center",
                      gap: "8px",
                      padding: "8px 10px",
                      "border-radius": "8px",
                      background: "var(--md-surface-muted)",
                      "font-size": "13px",
                    }}
                  >
                    {node().type === "folder" ? <FolderIcon size={16} /> : <FileIcon size={16} />}
                    <span>{node().name}</span>
                    <span style={mutedStyle}>{node().type === "folder" ? "文件夹" : "文件"}</span>
                  </div>
                )}
              </Show>

              <Show when={pickerOpen()}>
                <div
                  style={{
                    "border-radius": "10px",
                    border: "1px solid var(--md-border)",
                    padding: "12px",
                    display: "grid",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
                    <Button size="sm" variant="ghost" onClick={backFolder}>
                      返回上级
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!pickerParent()}
                      onClick={pickCurrentFolder}
                    >
                      选择当前文件夹
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPickerOpen(false)}>
                      <XIcon size={14} /> 关闭
                    </Button>
                  </div>
                  <Show when={pickerError()}>
                    <Alert variant="error">{pickerError()}</Alert>
                  </Show>
                  <Show when={pickerLoading()}>
                    <div style={mutedStyle}>读取目录…</div>
                  </Show>
                  <Show when={!pickerLoading() && pickerItems().length === 0}>
                    <div style={mutedStyle}>目录为空</div>
                  </Show>
                  <div
                    style={{ display: "grid", gap: "4px", "max-height": "260px", overflow: "auto" }}
                  >
                    <For each={pickerItems()}>
                      {(item) => (
                        <div
                          style={{
                            display: "flex",
                            "align-items": "center",
                            gap: "8px",
                            padding: "6px 8px",
                            "border-radius": "6px",
                            background: "var(--md-surface-muted)",
                          }}
                        >
                          {item.type === "folder" ? (
                            <FolderIcon size={15} />
                          ) : (
                            <FileIcon size={15} />
                          )}
                          <button
                            type="button"
                            style={{
                              flex: "1",
                              "text-align": "left",
                              background: "transparent",
                              border: "0",
                              padding: "0",
                              color: "var(--md-text)",
                              cursor: "pointer",
                              "font-size": "13px",
                            }}
                            onClick={() => {
                              if (item.type === "folder") {
                                enterFolder(item);
                              } else {
                                setSelectedNode(item);
                                setPickerOpen(false);
                              }
                            }}
                          >
                            {item.name}
                          </button>
                          <Show when={item.type === "folder"}>
                            <Button size="sm" variant="ghost" onClick={() => enterFolder(item)}>
                              进入
                            </Button>
                          </Show>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedNode(item);
                              setPickerOpen(false);
                            }}
                          >
                            <CheckIcon size={14} /> 选择
                          </Button>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              <div style={{ display: "grid", gap: "10px", "grid-template-columns": "1fr 1fr" }}>
                <TextField
                  label="访问密码（可选）"
                  type="password"
                  placeholder="至少 4 位，留空则无密码"
                  value={password()}
                  onInput={(event) => setPassword(event.currentTarget.value)}
                />
                <div style={{ display: "grid", gap: "6px" }}>
                  <label style={{ "font-size": "12px", color: "var(--md-text-muted)" }}>
                    有效期（可选）
                  </label>
                  <input
                    type="datetime-local"
                    style={inputStyle}
                    value={expiresAt()}
                    onInput={(event) => setExpiresAt(event.currentTarget.value)}
                  />
                </div>
              </div>

              <div style={{ display: "grid", gap: "10px", "grid-template-columns": "1fr 1fr" }}>
                <TextField
                  label="下载次数上限（可选）"
                  placeholder="留空则不限"
                  value={maxDownloads()}
                  onInput={(event) => setMaxDownloads(event.currentTarget.value)}
                />
                <div style={{ display: "grid", gap: "6px", "align-content": "start" }}>
                  <span style={{ "font-size": "12px", color: "var(--md-text-muted)" }}>权限</span>
                  <label style={{ "font-size": "13px" }}>
                    <input
                      type="checkbox"
                      checked={canPreview()}
                      onChange={(event) => setCanPreview(event.currentTarget.checked)}
                    />{" "}
                    允许预览
                  </label>
                  <label style={{ "font-size": "13px" }}>
                    <input
                      type="checkbox"
                      checked={canDownload()}
                      onChange={(event) => setCanDownload(event.currentTarget.checked)}
                    />{" "}
                    允许下载
                  </label>
                  <label style={{ "font-size": "13px" }}>
                    <input
                      type="checkbox"
                      checked={canList()}
                      onChange={(event) => setCanList(event.currentTarget.checked)}
                    />{" "}
                    允许浏览目录
                  </label>
                </div>
              </div>

              <Show when={createError()}>
                <Alert variant="error" title="创建失败">
                  {createError()}
                </Alert>
              </Show>
            </div>
          </CardBody>
          <CardFooter>
            <Button variant="primary" loading={creating()} onClick={() => void createShare()}>
              <PlusIcon size={15} /> 创建分享
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader title="分享列表" description={`共 ${shares().length} 条`} />
          <CardBody>
            <Show when={loading()}>
              <div style={mutedStyle}>加载中…</div>
            </Show>
            <Show when={!loading() && shares().length === 0}>
              <div style={mutedStyle}>还没有分享，先在上方创建一个。</div>
            </Show>
            <div style={{ display: "grid", gap: "10px" }}>
              <For each={shares()}>
                {(row) => (
                  <div
                    style={{
                      border: "1px solid var(--md-border)",
                      "border-radius": "10px",
                      padding: "12px",
                      display: "grid",
                      gap: "8px",
                    }}
                  >
                    <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                      {row.nodeType === "folder" ? (
                        <FolderIcon size={16} />
                      ) : (
                        <FileIcon size={16} />
                      )}
                      <span style={{ "font-weight": 600 }}>{row.nodeName}</span>
                      <span style={mutedStyle}>
                        {row.nodeType === "folder" ? "文件夹" : formatBytes(row.nodeSize)}
                      </span>
                      <span style={{ ...mutedStyle, "margin-left": "auto" }}>
                        {statusLabel(row)}
                      </span>
                    </div>
                    <div
                      style={{ display: "flex", gap: "16px", "flex-wrap": "wrap", ...mutedStyle }}
                    >
                      <span>{row.hasPassword ? "有密码" : "无密码"}</span>
                      <span>有效期：{formatDateTime(row.expiresAt)}</span>
                      <span>
                        下载：{row.downloadCount}
                        {row.maxDownloads === null ? " / 不限" : ` / ${row.maxDownloads}`}
                      </span>
                      <span>创建：{formatDateTime(row.createdAt)}</span>
                    </div>
                    <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void copyLink(row.token)}
                      >
                        <ShareIcon size={14} /> 复制链接
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => window.open(shareUrl(row.token), "_blank")}
                      >
                        <ExternalLinkIcon size={14} /> 打开
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => startEdit(row)}>
                        <PencilIcon size={14} /> 编辑
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void toggleLogs(row)}>
                        <InfoIcon size={14} /> 访问日志
                      </Button>
                      <Button
                        size="sm"
                        variant="dangerGhost"
                        disabled={row.status === "revoked"}
                        onClick={() => void revokeShare(row)}
                      >
                        <XIcon size={14} /> 撤销
                      </Button>
                    </div>

                    <Show when={editingId() === row.id}>
                      <div
                        style={{
                          display: "grid",
                          gap: "10px",
                          padding: "10px",
                          "border-radius": "8px",
                          background: "var(--md-surface-muted)",
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gap: "10px",
                            "grid-template-columns": "1fr 1fr",
                          }}
                        >
                          <TextField
                            label="新密码（留空不改，输入后覆盖）"
                            type="password"
                            value={editPassword()}
                            onInput={(event) => setEditPassword(event.currentTarget.value)}
                            hint="勾选下方「清除密码」可改为无密码"
                          />
                          <div style={{ display: "grid", gap: "6px" }}>
                            <label style={{ "font-size": "12px", color: "var(--md-text-muted)" }}>
                              有效期（留空 = 永久）
                            </label>
                            <input
                              type="datetime-local"
                              style={inputStyle}
                              value={editExpiresAt()}
                              onInput={(event) => setEditExpiresAt(event.currentTarget.value)}
                            />
                          </div>
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gap: "10px",
                            "grid-template-columns": "1fr 1fr",
                          }}
                        >
                          <TextField
                            label="下载次数上限（留空 = 不限）"
                            value={editMaxDownloads()}
                            onInput={(event) => setEditMaxDownloads(event.currentTarget.value)}
                          />
                          <div style={{ display: "grid", gap: "6px" }}>
                            <label style={{ "font-size": "13px" }}>
                              <input
                                type="checkbox"
                                checked={editCanPreview()}
                                onChange={(event) => setEditCanPreview(event.currentTarget.checked)}
                              />{" "}
                              允许预览
                            </label>
                            <label style={{ "font-size": "13px" }}>
                              <input
                                type="checkbox"
                                checked={editCanDownload()}
                                onChange={(event) =>
                                  setEditCanDownload(event.currentTarget.checked)
                                }
                              />{" "}
                              允许下载
                            </label>
                            <label style={{ "font-size": "13px" }}>
                              <input
                                type="checkbox"
                                checked={editCanList()}
                                onChange={(event) => setEditCanList(event.currentTarget.checked)}
                              />{" "}
                              允许浏览目录
                            </label>
                          </div>
                        </div>
                        <Show when={editError()}>
                          <Alert variant="error">{editError()}</Alert>
                        </Show>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <Button
                            size="sm"
                            variant="primary"
                            loading={saving()}
                            onClick={() => void saveEdit()}
                          >
                            保存
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                            取消
                          </Button>
                        </div>
                      </div>
                    </Show>

                    <Show when={logShareId() === row.id}>
                      <div
                        style={{
                          padding: "10px",
                          "border-radius": "8px",
                          background: "var(--md-surface-muted)",
                          display: "grid",
                          gap: "6px",
                          "font-size": "12px",
                        }}
                      >
                        <Show when={logError()}>
                          <Alert variant="error">{logError()}</Alert>
                        </Show>
                        <Show when={logLoading()}>
                          <span style={mutedStyle}>加载日志…</span>
                        </Show>
                        <Show when={!logLoading() && logItems().length === 0}>
                          <span style={mutedStyle}>暂无访问记录</span>
                        </Show>
                        <For each={logItems()}>
                          {(log) => (
                            <div style={{ display: "flex", gap: "12px", "flex-wrap": "wrap" }}>
                              <span>
                                {{ view: "访问", download: "下载", password_fail: "密码错误" }[
                                  log.action
                                ] ?? log.action}
                              </span>
                              <span style={mutedStyle}>{formatDateTime(log.createdAt)}</span>
                              <span style={mutedStyle}>{log.ip ?? "未知 IP"}</span>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </CardBody>
        </Card>
      </div>
    </Protected>
  );
}
