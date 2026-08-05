"use client";

import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { LocaleSwitcher } from "./locale-switcher";
import { StoreBadges } from "./store-badges";

export function MobileMenu() {
  const t = useTranslations("nav");
  const tMenu = useTranslations("mobileMenu");
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const links: { href: string; label: string }[] = [
    { href: "/#voices", label: t("voices") },
    { href: "/#how", label: t("how") },
    { href: "/#faq", label: t("faq") },
    { href: "/company", label: t("company") },
    { href: "/contact", label: t("contact") },
  ];

  return (
    <>
      <button
        type="button"
        aria-label={tMenu("open")}
        aria-expanded={open}
        aria-controls="mobile-menu-panel"
        onClick={() => setOpen(true)}
        className="inline-grid h-10 w-10 place-items-center rounded-full border border-line bg-surface text-text-muted transition-[color] duration-150 ease-[var(--ease-ui)] hover:text-text focus-visible:text-text md:hidden"
      >
        <Menu className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          id="mobile-menu-panel"
          role="dialog"
          aria-modal="true"
          aria-label={tMenu("panelLabel")}
          className="fixed inset-0 z-50 flex flex-col bg-bg/95 backdrop-blur md:hidden"
        >
          <div className="flex items-center justify-between px-5 py-5">
            <span className="text-[15px] font-bold tracking-tight text-text">
              AlarmTalk
            </span>
            <button
              ref={closeButtonRef}
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
        </div>
      )}
    </>
  );
}
