import { Protected } from "~/components/layout/protected";
import { FeaturePlaceholder } from "~/components/layout/placeholder";

export default function SettingsPage() {
  return (
    <Protected title="系统设置" description="站点、上传、AI 与邮件等全局配置">
      <FeaturePlaceholder
        title="系统设置将在 P3 / P4 逐步开放"
        description="站点名称、上传分片大小、回收站保留期、SMTP 邮件、WebDAV 等配置项。"
        hint="当前可通过 ./cli.sh 与 /api-reference 完成基础配置与调试。"
      />
    </Protected>
  );
}
