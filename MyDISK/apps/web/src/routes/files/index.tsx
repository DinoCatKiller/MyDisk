import { createFileRoute, redirect } from "@tanstack/solid-router";

import { FilesBrowser } from "~/components/file/files-browser";
import { loadFiles } from "~/lib/files-loader";

export const Route = createFileRoute("/files/")({
  // 强制改密 gate（`D4`）：渲染前弹回，避免「先渲染再跳转」的 URL/内容脱节
  beforeLoad: ({ context }) => {
    if (context.session?.mustChangePassword) {
      throw redirect({ to: "/settings/security", search: { force: true } });
    }
  },
  loader: () => loadFiles(null),
  component: FilesIndexRoute,
});

function FilesIndexRoute() {
  const data = Route.useLoaderData();
  return <FilesBrowser data={data()} />;
}
