import { Protected } from "~/components/layout/protected";
import { FeaturePlaceholder } from "~/components/layout/placeholder";

export default function FavoritesPage() {
  return (
    <Protected title="收藏" description="标记为收藏的文件与文件夹">
      <FeaturePlaceholder
        title="收藏功能将在 P2 提供"
        description="文件列表与收藏标记会随文件管理模块一起交付。"
        hint="届时可在此查看所有被收藏的条目，并直接跳转到所在目录。"
      />
    </Protected>
  );
}
