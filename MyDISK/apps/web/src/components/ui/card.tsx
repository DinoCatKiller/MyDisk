import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import styles from "./card.module.css";

export type CardProps = {
  class?: string;
  children?: JSX.Element;
};

export function Card(props: CardProps) {
  return (
    <section class={[styles.card, props.class ?? ""].filter(Boolean).join(" ")}>
      {props.children}
    </section>
  );
}

export type CardHeaderProps = {
  title: string;
  description?: string;
  action?: JSX.Element;
};

export function CardHeader(props: CardHeaderProps) {
  return (
    <header class={styles.header}>
      <div>
        <h2 class={styles.title}>{props.title}</h2>
        <Show when={props.description}>
          <p class={styles.description}>{props.description}</p>
        </Show>
      </div>
      <Show when={props.action}>{props.action}</Show>
    </header>
  );
}

export function CardBody(props: CardProps) {
  return <div class={styles.body}>{props.children}</div>;
}

export function CardFooter(props: CardProps) {
  return <footer class={styles.footer}>{props.children}</footer>;
}
