import { useNavigate } from "@solidjs/router";
import { createSignal, onSettled } from "solid-js";

import { client } from "~/utils/orpc";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  status?: string | null;
  mustChangePassword?: boolean | null;
  image?: string | null;
  lastLoginAt?: string | Date | null;
};

const [user, setUser] = createSignal<SessionUser | null>(null);
const [pending, setPending] = createSignal(true);

/** 会话只拉取一次，多个页面共享同一 promise */
let sessionPromise: Promise<SessionUser | null> | null = null;

export const sessionUser = user;
export const sessionPending = pending;

export function isFounder(): boolean {
  return user()?.role === "founder";
}

export async function refreshSession(): Promise<SessionUser | null> {
  setPending(true);
  try {
    const data = await client.auth.getSession();
    const next = (data?.user as SessionUser | undefined) ?? null;
    setUser(next);
    sessionPromise = Promise.resolve(next);
    return next;
  } catch {
    setUser(null);
    sessionPromise = Promise.resolve(null);
    return null;
  } finally {
    setPending(false);
  }
}

export function ensureSession(): Promise<SessionUser | null> {
  sessionPromise ??= refreshSession();
  return sessionPromise;
}

export async function signIn(input: {
  email: string;
  password: string;
  rememberMe?: boolean;
}): Promise<{ mustChangePassword: boolean }> {
  const result = await client.auth.signIn(input);
  await refreshSession();
  return { mustChangePassword: Boolean(result?.mustChangePassword) };
}

export async function signOut(): Promise<void> {
  try {
    await client.auth.signOut();
  } finally {
    setUser(null);
    sessionPromise = Promise.resolve(null);
  }
}

/** 受保护页面使用：未登录时跳转登录页 */
export function useRequireAuth(): void {
  const navigate = useNavigate();
  onSettled(() => {
    void ensureSession().then((current) => {
      if (!current) {
        navigate("/login", { replace: true });
      }
    });
  });
}
