import type { RouterClient } from "@orpc/server";

import { authRouter } from "./routers/auth";
import { archiveRouter, taskRouter } from "./routers/archive";
import { connectionRouter } from "./routers/connection";
import { fileRouter } from "./routers/file";
import { previewRouter } from "./routers/preview";
import { shareRouter } from "./routers/share";
import { systemRouter } from "./routers/system";
import { uploadRouter } from "./routers/upload";

export const appRouter = {
  system: systemRouter,
  auth: authRouter,
  connection: connectionRouter,
  file: fileRouter,
  upload: uploadRouter,
  preview: previewRouter,
  share: shareRouter,
  archive: archiveRouter,
  task: taskRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
