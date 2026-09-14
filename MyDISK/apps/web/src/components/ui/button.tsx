import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerGhost";
export type ButtonSize = "sm" | "md";

export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  class?: string;
  children?: JSX.Element;
  onClick?: (event: MouseEvent) => void;
};

export function Button(props: ButtonProps) {
  const classes = () =>
    [
      styles.base,
      styles[props.size ?? "md"],
      styles[props.variant ?? "secondary"],
      props.block ? styles.block : "",
      props.class ?? "",
    ]
      .filter(Boolean)
      .join(" ");

  return (
    <button
      type={props.type ?? "button"}
      title={props.title}
      class={classes()}
      disabled={props.disabled || props.loading}
      onClick={(event) => props.onClick?.(event as MouseEvent)}
    >
      <Show when={props.loading}>
        <span class={styles.spinner} />
      </Show>
      {props.children}
    </button>
  );
}
