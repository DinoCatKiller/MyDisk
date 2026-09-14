import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import { fileRoutes } from "filesystem-routing/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    varlockVitePlugin({ ssrInjectMode: "auto-load" }),
    solid({
      start: { middleware: "./src/middleware.ts" },
      ssr: true,
      extensions: [".jsx", ".tsx"],
    }),
    nitro({ serverEntry: false }),
    fileRoutes({ httpMethods: true }),
    tailwindcss(),
  ],
  server: {
    port: 3001,
  },
  ssr: {
    noExternal: ["solid-js", /^@solidjs\//, "@tanstack/solid-query"],
  },
  resolve: {
    tsconfigPaths: true,
  },
});
