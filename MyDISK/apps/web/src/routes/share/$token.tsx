import { createFileRoute } from "@tanstack/solid-router";
import { For, Show, createSignal, onSettled } from "solid-js";

import type { PublicFileNode, PublicShareInfo } from "@MyDISK/api/schemas/share";

import { Alert } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardBody, CardHeader } from "~/components/ui/card";
import { DownloadIcon, FileIcon, FolderIcon, LockIcon, ShareIcon } from "~/components/ui/icons";
import { TextField } from "~/components/ui/input";
import { formatBytes } from "~/lib/format";
import { client } from "~/utils/orpc";

const mutedStyle = { color: "var(--md-text-muted)", "font-size": "12px" } as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const Route = createFileRoute("/share/$token")({
  component: PublicSharePage,
});

function PublicSharePage() {
  const params = Route.useParams();

  const [info, setInfo] = createSignal<PublicShareInfo | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [shareToken, setShareToken] = createSignal<string | null>(null);
  const [unlocking, setUnlocking] = createSignal(false);
  const [unlockError, setUnlockError] = createSignal("");

  const [items, setItems] = createSignal<PublicFileNode[]>([]);
  const [path, setPath] = createSignal<{ id: string; name: string }[]>([]);
  const [listLoading, setListLoading] = createSignal(false);
  const [listError, setListError] = createSignal("");
  const [downloading, setDownloading] = createSignal<string | null>(null);

  const token = () => params().token;

  const loadList = async (parentNodeId?: string) => {
    setListLoading(true);
    setListError("");
    try {
      const page = await client.share.public.list({
        token: token(),
        shareToken: shareToken() ?? undefined,
        parentNodeId,
        page: 1,
        pageSize: 200,
      });
      setItems(page.items);
    } catch (loadError) {
      setListError(errorMessage(loadError));
    } finally {
      setListLoading(false);
    }
  };

  const loadInfo = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await client.share.public.info({ token: token() });
      setInfo(data);
      if (!data.needPassword) {
        setShareToken(null);
        if (data.node.type === "folder") {
          await loadList();
        }
      }
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  onSettled(() => {
    void loadInfo();
  });

  const unlock = async () => {
    if (!password().trim()) {
      setUnlockError("请输入密码");
      return;
    }
    setUnlocking(true);
    setUnlockError("");
    try {
      const result = await client.share.public.unlock({
        token: token(),
        password: password(),
      });
      setShareToken(result.shareToken);
      if (info()?.node.type === "folder") {
        await loadList();
      }
    } catch (unlockFailure) {
      setUnlockError(errorMessage(unlockFailure));
    } finally {
      setUnlocking(false);
    }
  };

  const enterFolder = (node: PublicFileNode) => {
    setPath([...path(), { id: node.id, name: node.name }]);
    void loadList(node.id);
  };

  const goBack = () => {
    const next = path().slice(0, -1);
    setPath(next);
    void loadList(next.at(-1)?.id);
  };

  const download = async (nodeId?: string) => {
    const key = nodeId ?? "__root__";
    setDownloading(key);
    setError("");
    try {
      const result = await client.share.public.downloadUrl({
        token: token(),
        shareToken: shareToken() ?? undefined,
        nodeId,
      });
      window.location.assign(result.url);
    } catch (downloadError) {
      setError(errorMessage(downloadError));
    } finally {
      setDownloading(null);
    }
  };

  const needPassword = () => {
    const current = info();
    return current?.needPassword === true && shareToken() === null;
  };

  return (
    <main
      style={{
        "min-height": "100vh",
        padding: "32px 16px",
        background: "var(--md-bg)",
        color: "var(--md-text)",
      }}
    >
      <div style={{ "max-width": "760px", margin: "0 auto", display: "grid", gap: "16px" }}>
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <ShareIcon size={20} />
          <span style={{ "font-size": "15px", "font-weight": 600 }}>MyDisk 分享</span>
        </div>

        <Show when={loading()}>
          <Card>
            <CardBody>
              <div style={mutedStyle}>正在加载分享…</div>
            </CardBody>
          </Card>
        </Show>

        <Show when={!loading() && error()}>
          <Alert variant="error" title="无法访问该分享">
            {error()}
          </Alert>
        </Show>

        <Show when={!loading() && info()}>
          {(current) => (
            <Card>
              <CardHeader
                title={current().node.name}
                description={
                  current().node.type === "folder"
                    ? "文件夹分享"
                    : `文件分享 · ${formatBytes(current().node.size)}`
                }
              />
              <CardBody>
                <Show when={current().expiresAt}>
                  {(expiresAt) => (
                    <div style={{ ...mutedStyle, "margin-bottom": "10px" }}>
                      有效期至 {expiresAt().toLocaleString("zh-CN", { hour12: false })}
                    </div>
                  )}
                </Show>

                <Show when={needPassword()}>
                  <div style={{ display: "grid", gap: "10px", "max-width": "320px" }}>
                    <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                      <LockIcon size={15} />
                      <span style={{ "font-size": "13px" }}>该分享已加密，请输入访问密码</span>
                    </div>
                    <TextField
                      label="访问密码"
                      type="password"
                      value={password()}
                      onInput={(event) => setPassword(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void unlock();
                        }
                      }}
                    />
                    <Show when={unlockError()}>
                      <Alert variant="error">{unlockError()}</Alert>
                    </Show>
                    <Button variant="primary" loading={unlocking()} onClick={() => void unlock()}>
                      解锁
                    </Button>
                  </div>
                </Show>

                <Show when={!needPassword()}>
                  <Show
                    when={current().node.type === "file" && current().canDownload}
                    fallback={
                      <div style={{ display: "grid", gap: "10px" }}>
                        <Show when={current().canList}>
                          <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
                            <Show when={path().length > 0}>
                              <Button size="sm" variant="ghost" onClick={goBack}>
                                返回上级
                              </Button>
                            </Show>
                            <span style={{ ...mutedStyle, "align-self": "center" }}>
                              {path().length === 0
                                ? "根目录"
                                : path()
                                    .map((item) => item.name)
                                    .join(" / ")}
                            </span>
                          </div>
                          <Show when={listError()}>
                            <Alert variant="error">{listError()}</Alert>
                          </Show>
                          <Show when={listLoading()}>
                            <div style={mutedStyle}>读取目录…</div>
                          </Show>
                          <Show when={!listLoading() && items().length === 0}>
                            <div style={mutedStyle}>目录为空</div>
                          </Show>
                          <div style={{ display: "grid", gap: "4px" }}>
                            <For each={items()}>
                              {(item) => (
                                <div
                                  style={{
                                    display: "flex",
                                    "align-items": "center",
                                    gap: "8px",
                                    padding: "8px 10px",
                                    "border-radius": "8px",
                                    background: "var(--md-surface-muted)",
                                  }}
                                >
                                  {item.type === "folder" ? (
                                    <FolderIcon size={16} />
                                  ) : (
                                    <FileIcon size={16} />
                                  )}
                                  <Show
                                    when={item.type === "folder"}
                                    fallback={
                                      <span style={{ flex: "1", "font-size": "13px" }}>
                                        {item.name}
                                        <span style={{ ...mutedStyle, "margin-left": "8px" }}>
                                          {formatBytes(item.size)}
                                        </span>
                                      </span>
                                    }
                                  >
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
                                      onClick={() => enterFolder(item)}
                                    >
                                      {item.name}
                                    </button>
                                  </Show>
                                  <Show when={item.type === "file" && current().canDownload}>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      loading={downloading() === item.id}
                                      onClick={() => void download(item.id)}
                                    >
                                      <DownloadIcon size={14} /> 下载
                                    </Button>
                                  </Show>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                        <Show when={!current().canList}>
                          <div style={mutedStyle}>该分享不允许浏览目录。</div>
                        </Show>
                      </div>
                    }
                  >
                    <Button
                      variant="primary"
                      loading={downloading() === "__root__"}
                      onClick={() => void download()}
                    >
                      <DownloadIcon size={15} /> 下载文件
                    </Button>
                  </Show>
                </Show>
              </CardBody>
            </Card>
          )}
        </Show>

        <Show when={!loading() && error()}>
          <div style={mutedStyle}>分享链接由 MyDisk 用户创建，请联系分享者确认有效期与密码。</div>
        </Show>
      </div>
    </main>
  );
}
