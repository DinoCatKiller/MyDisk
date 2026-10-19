import { createFileRoute } from "@tanstack/solid-router";

import { FilesBrowser } from "~/components/file/files-browser";
import { loadFiles } from "~/lib/files-loader";

export const Route = createFileRoute("/files/")({
  loader: () => loadFiles(null),
  component: FilesIndexRoute,
});

function FilesIndexRoute() {
  const data = Route.useLoaderData();
  return <FilesBrowser data={data()} />;
}
