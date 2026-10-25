import { createFileRoute, redirect } from "@tanstack/solid-router";

import { FilesBrowser } from "~/components/file/files-browser";
import { lastSegment, loadFiles } from "~/lib/files-loader";

export const Route = createFileRoute("/files/$")({
  // 强制改密 gate（`D4`）：与 `/files/` 一致，渲染前弹回
  beforeLoad: ({ context }) => {
    if (context.session?.mustChangePassword) {
      throw redirect({ to: "/settings/security", search: { force: true } });
    }
  },
  loader: ({ params }) => loadFiles(lastSegment(params._splat)),
  component: FilesSplatRoute,
});

function FilesSplatRoute() {
  const data = Route.useLoaderData();
  return <FilesBrowser data={data()} />;
}
