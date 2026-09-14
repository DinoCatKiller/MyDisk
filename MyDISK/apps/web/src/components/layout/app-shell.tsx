import type { JSX } from "@solidjs/web";
import { useLocation, useNavigate } from "@solidjs/router";
import { For, Show, createSignal, onCleanup, onSettled } from "solid-js";

import {
  ChevronDownIcon,
  FolderTreeIcon,
  HardDriveIcon,
  LogOutIcon,
  SettingsIcon,
  ShareIcon,
  ShieldCheckIcon,
  StarIcon,
  TrashIcon,
  UsersIcon,
} from "~/components/ui/icons";
import { isFounder, sessionUser, signOut } from "~/lib/session";

import styles from "./app-shell.module.css";

type NavEntry = {
  href: string;
  label: string;
  icon: JSX.Element;
};

type NavGroup = {
  label: string;
  items: NavEntry[];
};

export type AppShellProps = {
  title: string;
  description?: string;
  actions?: JSX.Element;
  children: JSX.Element;
};

export function AppShell(props: AppShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = createSignal(false);

  const groups = (): NavGroup[] => {
    const systemItems: NavEntry[] = [
      { href: "/settings/storage", label: "存储连接", icon: <HardDriveIcon /> },
      { href: "/settings/security", label: "账户安全", icon: <ShieldCheckIcon /> },
      { href: "/settings", label: "系统设置", icon: <SettingsIcon /> },
    ];
    if (isFounder()) {
      systemItems.push({ href: "/admin/users", label: "管理员", icon: <UsersIcon /> });
    }

    return [
      {
        label: "存储",
        items: [
          { href: "/files", label: "全部文件", icon: <FolderTreeIcon /> },
          { href: "/favorites", label: "收藏", icon: <StarIcon /> },
          { href: "/trash", label: "回收站", icon: <TrashIcon /> },
          { href: "/shares", label: "分享", icon: <ShareIcon /> },
        ],
      },
      { label: "系统", items: systemItems },
    ];
  };

  const isActive = (href: string) =>
    location.pathname === href || location.pathname.startsWith(`${href}/`);

  const initial = () => (sessionUser()?.name ?? "?").slice(0, 1);

  onSettled(() => {
    const onDocumentClick = () => setMenuOpen(false);
    document.addEventListener("click", onDocumentClick);
    onCleanup(() => document.removeEventListener("click", onDocumentClick));
  });

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div class={styles.shell}>
      <aside class={styles.sidebar}>
        <a class={styles.brand} href="/files">
          <span class={styles.brandMark}>M</span>
          <span class={styles.brandText}>
            <span class={styles.brandName}>MyDisk</span>
            <span class={styles.brandSub}>私人云盘</span>
          </span>
        </a>

        <For each={groups()}>
          {(group) => (
            <nav class={styles.navGroup}>
              <span class={styles.navLabel}>{group.label}</span>
              <For each={group.items}>
                {(item) => (
                  <a
                    href={item.href}
                    class={
                      isActive(item.href)
                        ? `${styles.navItem} ${styles.navItemActive}`
                        : styles.navItem
                    }
                  >
                    <span class={styles.navIcon}>{item.icon}</span>
                    {item.label}
                  </a>
                )}
              </For>
            </nav>
          )}
        </For>

        <div class={styles.sidebarFooter}>MyDisk v1.0.0</div>
      </aside>

      <div class={styles.main}>
        <header class={styles.header}>
          <div>
            <h1 class={styles.headerTitle}>{props.title}</h1>
            <Show when={props.description}>
              <p class={styles.headerSub}>{props.description}</p>
            </Show>
          </div>

          <Show when={props.actions}>
            <div>{props.actions}</div>
          </Show>

          <div class={styles.account} onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              class={styles.accountButton}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span class={styles.avatar}>{initial()}</span>
              <span class={styles.accountName}>{sessionUser()?.name ?? "未登录"}</span>
              <ChevronDownIcon size={15} />
            </button>

            <Show when={menuOpen()}>
              <div class={styles.menu}>
                <div class={styles.menuHeader}>
                  <div class={styles.menuName}>{sessionUser()?.name}</div>
                  <div class={styles.menuEmail}>{sessionUser()?.email}</div>
                </div>
                <button
                  type="button"
                  class={styles.menuItem}
                  onClick={() => {
                    setMenuOpen(false);
                    navigate("/settings/security");
                  }}
                >
                  <ShieldCheckIcon size={16} />
                  账户安全
                </button>
                <button
                  type="button"
                  class={`${styles.menuItem} ${styles.menuItemDanger}`}
                  onClick={() => void handleSignOut()}
                >
                  <LogOutIcon size={16} />
                  退出登录
                </button>
              </div>
            </Show>
          </div>
        </header>

        <main class={styles.content}>{props.children}</main>
      </div>
    </div>
  );
}

export function SessionLoading() {
  return <div class={styles.center}>正在加载…</div>;
}
