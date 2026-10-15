import type { RouterClient } from "@orpc/server";

import { authRouter } from "./auth";
import { connectionRouter } from "./connection";
import { fileRouter } from "./file";
import { previewRouter } from "./preview";
import { systemRouter } from "./system";
import { uploadRouter } from "./upload";

export const appRouter = {
  system: systemRouter,
  auth: authRouter,
  connection: connectionRouter,
  file: fileRouter,
  upload: uploadRouter,
  preview: previewRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;

export { authRouter, connectionRouter, fileRouter, previewRouter, systemRouter, uploadRouter };
