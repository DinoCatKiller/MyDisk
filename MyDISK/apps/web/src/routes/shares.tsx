import { Protected } from "~/components/layout/protected";
import { FeaturePlaceholder } from "~/components/layout/placeholder";

export default function SharesPage() {
  return (
    <Protected title="分享" description="已创建的分享链接">
      <FeaturePlaceholder
        title="分享功能将在 P3 提供"
        description="支持文件与文件夹分享、访问密码、有效期与下载次数限制。"
        hint="公开分享页 /share/<token> 会呈现与管理端一致的目录结构，可预览也可下载。"
      />
    </Protected>
  );
}
