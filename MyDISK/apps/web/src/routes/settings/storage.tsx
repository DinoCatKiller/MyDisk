import { Protected } from "~/components/layout/protected";
import { FeaturePlaceholder } from "~/components/layout/placeholder";

export default function StorageSettingsPage() {
  return (
    <Protected title="存储连接" description="本地 / 腾讯云 COS / 阿里云 OSS / S3">
      <FeaturePlaceholder
        title="多存储连接管理将在 P3 提供"
        description="一个类型可创建多个连接；本地连接全局唯一，根目录位于项目根下的 storage 目录。"
        hint="切换默认连接时可选择是否同步已有文件，也可稍后在设置页手动同步。"
      />
    </Protected>
  );
}
