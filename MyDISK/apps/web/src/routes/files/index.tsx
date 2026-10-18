import { createFileRoute } from "@tanstack/solid-router";

import { FilesBrowser } from "~/components/file/files-browser";

export const Route = createFileRoute("/files/")({
  component: FilesIndexRoute,
});

function FilesIndexRoute() {
  return <FilesBrowser />;
}
