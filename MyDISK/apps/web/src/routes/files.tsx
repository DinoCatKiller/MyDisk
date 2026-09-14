import { useNavigate } from "@solidjs/router";
import { Show, createSignal, onSettled } from "solid-js";

import { Protected } from "~/components/layout/protected";
import { Alert } from "~/components/ui/alert";
import { Card, CardBody, CardHeader } from "~/components/ui/card";
import {
  ExternalLinkIcon,
  FolderTreeIcon,
  HardDriveIcon,
  ShareIcon,
  TrashIcon,
} from "~/components/ui/icons";
import { isFounder, sessionUser } from "~/lib/session";
import { client } from "~/utils/orpc";

type Stats = {
  fileCount: number;
  trashCount: number;
  connectionCount: number;
  shareCount: number;
};

function StatCard(props: { label: string; value: number | string; icon: unknown }) {
  return (
    <Card>
      <CardBody>
        <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
          <span
            style={{
              display: "grid",
              "place-items": "center",
              width: "36px",
              height: "36px",
              "border-radius": "10px",
              background: "var(--md-brand-soft)",
              color: "var(--md-brand)",
            }}
          >
            {props.icon as never}
          </span>
          <div>
            <div style={{ "font-size": "20px", "font-weight": 600, "line-height": "1.2" }}>
              {props.value}
            </div>
            <div style={{ "font-size": "12.5px", color: "var(--md-text-muted)" }}>
              {props.label}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

export default function FilesPage() {
  const navigate = useNavigate();
  const [stats, setStats] = createSignal<Stats | null>(null);
  const [error, setError] = createSignal("");

  onSettled(() => {
    if (sessionUser()?.mustChangePassword) {
      navigate("/settings/security?force=1");
      return;
    }
    void client.system
      .stats()
      .then((data) => setStats(data as Stats))
      .catch((loadError: unknown) =>
        setError(loadError instanceof Error ? loadError.message : "读取统计失败"),
      );
  });

  return (
    <Protected title="全部文件" description="存储概览与系统状态">
      <Show when={error()}>
        <Alert variant="error" class="mb-5">
          {error()}
        </Alert>
      </Show>

      <div
        style={{
          display: "grid",
          gap: "16px",
          "grid-template-columns": "repeat(auto-fit, minmax(220px, 1fr))",
        }}
      >
        <StatCard label="文件总数" value={stats()?.fileCount ?? "—"} icon={<FolderTreeIcon />} />
        <StatCard label="回收站" value={stats()?.trashCount ?? "—"} icon={<TrashIcon />} />
        <StatCard
          label="存储连接"
          value={stats()?.connectionCount ?? "—"}
          icon={<HardDriveIcon />}
        />
        <StatCard label="分享链接" value={stats()?.shareCount ?? "—"} icon={<ShareIcon />} />
      </div>

      <div style={{ display: "grid", gap: "16px", "margin-top": "16px" }}>
        <Card>
          <CardHeader
            title="当前阶段：P1 骨架已就绪"
            description="登录、权限、CLI 安装流程与 OpenAPI 文档均已可用"
          />
          <CardBody>
            <ul
              style={{
                margin: 0,
                padding: "0 0 0 18px",
                color: "var(--md-text-soft)",
                "font-size": "13px",
                "line-height": "2",
              }}
            >
              <li>已完成：数据库模型（19 张表）、本地存储驱动、认证与管理员体系、CLI 安装流程</li>
              <li>已完成：oRPC 全量接口 + OpenAPI 3.1 文档（认证、系统设置、统计）</li>
              <li>
                下一步（P2）：文件目录树、拖拽与文件夹上传、分片断点续传、暂停 /
                停止、移动重命名删除、回收站
              </li>
              <li>
                后续（P3 / P4）：COS / OSS / S3 驱动、多连接同步、分享、预览全家桶、BullMQ
                队列、WebDAV
              </li>
            </ul>

            <div
              style={{
                "margin-top": "14px",
                display: "flex",
                "align-items": "center",
                gap: "6px",
                "font-size": "13px",
              }}
            >
              <a
                href="http://localhost:3000/api-reference"
                target="_blank"
                rel="noreferrer"
                style={{
                  color: "var(--md-brand)",
                  display: "inline-flex",
                  "align-items": "center",
                  gap: "6px",
                }}
              >
                <ExternalLinkIcon size={15} />
                查看 OpenAPI 接口文档
              </a>
            </div>
          </CardBody>
        </Card>

        <Show when={isFounder()}>
          <Card>
            <CardHeader title="创始人提示" description="你拥有系统的全部权限" />
            <CardBody>
              <div style={{ "font-size": "13px", color: "var(--md-text-soft)" }}>
                可在「管理员」页面新增或移除普通管理员；创始人管理员不可被删除或禁用。
              </div>
            </CardBody>
          </Card>
        </Show>
      </div>
    </Protected>
  );
}
