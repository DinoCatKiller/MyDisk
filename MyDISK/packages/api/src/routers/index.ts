import type { RouterClient } from "@orpc/server";

import { authRouter } from "./auth";
import { systemRouter } from "./system";

export const appRouter = {
  system: systemRouter,
  auth: authRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;

export { authRouter, systemRouter };
