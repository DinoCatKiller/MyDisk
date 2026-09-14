import { Protected } from "~/components/layout/protected";
import { FeaturePlaceholder } from "~/components/layout/placeholder";

export default function TrashPage() {
  return (
    <Protected title="回收站" description="已删除的文件与文件夹">
      <FeaturePlaceholder
        title="回收站将在 P2 提供"
        description="删除的文件会进入回收站，可还原或彻底删除。"
        hint="默认保留 30 天，由后台维护队列自动清理（可在系统设置中调整）。"
      />
    </Protected>
  );
}
