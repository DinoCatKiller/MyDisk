import solid from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import { defineConfig, type Plugin } from "vite";

/**
 * Solid rc.15 把 `parseServerFunctionUrl` 改名为 `parseServerFunctionActionUrl`，
 * 但 @tanstack/solid-start 2.0.0-rc.8（上游无更新的 rc 版）仍按旧名导入。
 * 仅对 @tanstack/* 的 importer 做一次别名重写，不动依赖版本。
 */
function solidWebServerFunctionUrlShim(): Plugin {
  const SHIM_ID = "\0mydisk:solid-web-sfn-url-shim";
  const TARGET = "@solidjs/web/server-functions/server";
  return {
    name: "mydisk:solid-web-sfn-url-shim",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== TARGET) return;
      if (importer && /@tanstack[\\/](solid-start|start-)/.test(importer)) return SHIM_ID;
      return;
    },
    load(id) {
      if (id !== SHIM_ID) return;
      // shim 内部 importer 为 SHIM_ID，不匹配上面的正则，故不会递归
      return `export * from "${TARGET}";\nexport { parseServerFunctionActionUrl as parseServerFunctionUrl } from "${TARGET}";`;
    },
  };
}

export default defineConfig({
  plugins: [
    // 实测可用顺序（`GUI` §7 S0 结论 2）：shim → varlock → tanstackStart → solid → tailwindcss
    solidWebServerFunctionUrlShim(),
    varlockVitePlugin({ ssrInjectMode: "auto-load" }),
    tanstackStart({}),
    // Start 不自带 Solid JSX 编译，@solidjs/vite-plugin 必须保留（仅去掉 start 选项）
    solid({
      ssr: true,
      extensions: [".jsx", ".tsx"],
    }),
    tailwindcss(),
  ],
  server: {
    // 单 app：原 web 3001 / server 3000 收敛到 3000（`GUI` §5）
    port: 3000,
  },
  ssr: {
    noExternal: ["solid-js", /^@solidjs\//, "@tanstack/solid-query"],
  },
  resolve: {
    tsconfigPaths: true,
  },
});
