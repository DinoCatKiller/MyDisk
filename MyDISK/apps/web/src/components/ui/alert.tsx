import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import styles from "./alert.module.css";

export type AlertVariant = "info" | "success" | "warning" | "error";

export type AlertProps = {
  variant?: AlertVariant;
  title?: string;
  class?: string;
  children?: JSX.Element;
};

export function Alert(props: AlertProps) {
  const variant = () => props.variant ?? "info";

  return (
    <div
      class={[styles.alert, styles[variant()], props.class ?? ""].filter(Boolean).join(" ")}
      role={variant() === "error" ? "alert" : "status"}
    >
      <div>
        <Show when={props.title}>
          <div class={styles.title}>{props.title}</div>
        </Show>
        <Show when={props.children}>
          <div>{props.children}</div>
        </Show>
      </div>
    </div>
  );
}
