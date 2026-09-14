import { Show } from "solid-js";

import styles from "./input.module.css";

export type TextFieldProps = {
  label?: string;
  hint?: string;
  error?: string;
  id?: string;
  name?: string;
  type?: "text" | "email" | "password";
  value?: string;
  placeholder?: string;
  autocomplete?: string;
  disabled?: boolean;
  required?: boolean;
  class?: string;
  onInput?: (event: InputEvent & { currentTarget: HTMLInputElement }) => void;
  onKeyDown?: (event: KeyboardEvent & { currentTarget: HTMLInputElement }) => void;
};

let fieldSeed = 0;

export function TextField(props: TextFieldProps) {
  const inputId = () => props.id ?? props.name ?? `md-field-${(fieldSeed += 1)}`;

  const controlClass = () =>
    [styles.control, props.error ? styles.controlInvalid : ""].filter(Boolean).join(" ");

  return (
    <div class={[styles.field, props.class ?? ""].filter(Boolean).join(" ")}>
      <Show when={props.label}>
        <label class={styles.label} for={inputId()}>
          {props.label}
        </label>
      </Show>

      <div class={controlClass()}>
        <input
          id={inputId()}
          name={props.name}
          type={props.type ?? "text"}
          class={styles.input}
          value={props.value ?? ""}
          placeholder={props.placeholder}
          autocomplete={props.autocomplete}
          disabled={props.disabled}
          required={props.required}
          onInput={(event) => props.onInput?.(event)}
          onKeyDown={(event) => props.onKeyDown?.(event)}
        />
      </div>

      <Show when={props.error}>
        <span class={styles.error}>{props.error}</span>
      </Show>
      <Show when={!props.error && props.hint}>
        <span class={styles.hint}>{props.hint}</span>
      </Show>
    </div>
  );
}
