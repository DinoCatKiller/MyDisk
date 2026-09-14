import { useNavigate } from "@solidjs/router";
import { onSettled } from "solid-js";

export default function Home() {
  const navigate = useNavigate();

  onSettled(() => {
    navigate("/files", { replace: true });
  });

  return (
    <div
      style={{
        display: "grid",
        "place-items": "center",
        "min-height": "100vh",
        color: "var(--md-text-muted)",
      }}
    >
      正在进入 MyDisk…
    </div>
  );
}
