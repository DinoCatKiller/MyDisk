import { Title } from "@solidjs/meta";
import { QueryClientProvider } from "@tanstack/solid-query";
import { onSettled } from "solid-js";

import { ensureSession } from "~/lib/session";
import { Router } from "~/router";
import { createQueryClient } from "~/utils/orpc";

import "./styles.css";

export default function App() {
  const queryClient = createQueryClient();

  // 仅客户端加载会话，避免 SSR 期间跨请求共享状态
  onSettled(() => {
    void ensureSession();
  });

  return (
    <QueryClientProvider client={queryClient}>
      <Title>MyDisk · 私人云盘</Title>
      <Router>{(props) => <>{props.children}</>}</Router>
    </QueryClientProvider>
  );
}
