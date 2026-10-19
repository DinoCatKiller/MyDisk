import { createFileRoute } from "@tanstack/solid-router";

import { FilesBrowser } from "~/components/file/files-browser";
import { lastSegment, loadFiles } from "~/lib/files-loader";

export const Route = createFileRoute("/files/$")({
  loader: ({ params }) => loadFiles(lastSegment(params._splat)),
  component: FilesSplatRoute,
});

function FilesSplatRoute() {
  const data = Route.useLoaderData();
  return <FilesBrowser data={data()} />;
}
