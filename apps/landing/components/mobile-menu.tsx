"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { LocaleSwitcher } from "./locale-switcher";
import { StoreBadges } from "./store-badges";

/**
 * 모바일 메뉴는 **네이티브 `<dialog>`** 다.
 *
 * `div role="dialog"` 로 흉내 내면 포커스 트랩·top layer·Escape 를 전부 손으로 만들어야
 * 하고, 하나라도 빠지면 Tab 이 오버레이 뒤의 보이지 않는 링크로 빠져나간다(2026-09-06
 * 검수에서 실제로 그랬다). `showModal()` 은 그 셋을 브라우저가 맡고, 항상 마운트돼 있어
 * 트리거의 `aria-controls` 도 닫혀 있는 동안 유효하다. 닫히면 초점은 연 버튼으로 돌아간다.
 */
export function MobileMenu() {
  const t = useTranslations("nav");
  const tMenu = useTranslations("mobileMenu");
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const openButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      document.body.style.overflow = "hidden";
    } else if (dialog.open) {
      dialog.close();
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // 열어 둔 채 창을 넓히면 패널은 lg:hidden 으로 사라지는데 스크롤 잠금만 남는다 — 같이 닫는다.
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [open]);

  const links: { href: string; label: string }[] = [
    { href: "/#how", label: t("features") },
    { href: "/#pricing", label: t("pricing") },
    { href: "/cheer", label: t("cheer") },
    { href: "/#faq", label: t("faq") },
    { href: "/company", label: t("company") },
    { href: "/contact", label: t("contact") },
  ];

  return (
    <>
      <button
        ref={openButtonRef}
        type="button"
        aria-label={tMenu("open")}
        aria-expanded={open}
        aria-controls="mobile-menu-panel"
        onClick={() => setOpen(true)}
        className="inline-grid h-10 w-10 place-items-center rounded-full border border-line bg-surface text-text-muted transition-[color] duration-150 ease-[var(--ease-ui)] hover:text-text focus-visible:text-text lg:hidden"
      >
        <Menu className="h-4 w-4" aria-hidden="true" />
      </button>

      <dialog
        id="mobile-menu-panel"
        ref={dialogRef}
        aria-label={tMenu("panelLabel")}
        onClose={() => {
          setOpen(false);
          openButtonRef.current?.focus();
        }}
        className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none flex-col overflow-y-auto overscroll-contain bg-bg/95 p-0 text-text backdrop-blur open:flex lg:hidden"
      >
        <div className="flex items-center justify-between px-5 py-5">
          <span translate="no" className="text-[15px] font-bold tracking-tight text-text">
            AlarmTalk
          </span>
          <button
            type="button"
            aria-label={tMenu("close")}
            onClick={() => setOpen(false)}
            className="inline-grid h-10 w-10 place-items-center rounded-full border border-line bg-surface text-text-muted transition-[color] duration-150 ease-[var(--ease-ui)] hover:text-text focus-visible:text-text"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <nav className="flex flex-col gap-1 px-5 py-4">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="rounded-2xl border border-transparent px-4 py-4 text-[18px] font-semibold text-text transition-[color,background-color,border-color] duration-150 ease-[var(--ease-ui)] hover:border-line hover:bg-surface focus-visible:border-line focus-visible:bg-surface"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-4 border-t border-line px-5 py-6">
          <LocaleSwitcher />
          <StoreBadges />
        </div>
      </dialog>
    </>
  );
}
