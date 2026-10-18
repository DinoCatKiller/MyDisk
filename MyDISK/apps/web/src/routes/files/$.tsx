import { createFileRoute } from "@tanstack/solid-router";

import { FilesBrowser } from "~/components/file/files-browser";

export const Route = createFileRoute("/files/$")({
  component: FilesSplatRoute,
});

function FilesSplatRoute() {
  const params = Route.useParams();
  return <FilesBrowser path={params()._splat} />;
}
