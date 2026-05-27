import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { BrandMark } from "./brand-mark";
import { MobileMenu } from "./mobile-menu";

export function SiteHeader() {
  const t = useTranslations("nav");

  return (
    <header className="relative z-30">
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 md:px-8">
        <Link
          href="/"
          aria-label="AlarmTalk"
          className="flex items-center gap-2.5 whitespace-nowrap"
        >
          <BrandMark size={32} className="rounded-[8px]" />
          <span className="text-[17px] font-bold tracking-tight text-text">
            AlarmTalk
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          <Link
            href="/#voices"
            className="whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium text-text-muted transition hover:text-text"
          >
            {t("voices")}
          </Link>
          <Link
            href="/#how"
            className="whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium text-text-muted transition hover:text-text"
          >
            {t("how")}
          </Link>
          <Link
            href="/#faq"
            className="whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium text-text-muted transition hover:text-text"
          >
            {t("faq")}
          </Link>
          <Link
            href="/company"
            className="whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium text-text-muted transition hover:text-text"
          >
            {t("company")}
          </Link>
          <Link
            href="/contact"
            className="whitespace-nowrap rounded-full px-3.5 py-2 text-[13.5px] font-medium text-text-muted transition hover:text-text"
          >
            {t("contact")}
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <Link href="/#waitlist" className="btn btn-primary btn-sm hidden sm:inline-flex">
            {t("cta")}
          </Link>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
