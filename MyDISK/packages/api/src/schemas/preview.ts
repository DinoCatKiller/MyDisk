import * as z from "zod";

export const previewUrlInput = z.object({
  nodeId: z.uuid(),
  inline: z.boolean().default(true),
  download: z.boolean().default(false),
});

export const previewUrlSchema = z.object({
  url: z.string(),
  ttl: z.number(),
});
