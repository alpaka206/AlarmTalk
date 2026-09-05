import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { BrandMark } from "../brand-mark";
import { LocaleSwitcher } from "../locale-switcher";
import { RevealGroup, RevealItem } from "../motion/reveal-group";

export function SiteFooter() {
  const t = useTranslations("footer");
  const year = new Date().getFullYear();

  return (
    <footer className="relative">
      <div className="hairline" />
      <div className="mx-auto max-w-6xl px-5 py-14 md:px-8 lg:py-20">
        <RevealGroup
          as="div"
          stagger={0.08}
          className="flex flex-col gap-12 lg:flex-row lg:items-start lg:justify-between"
        >
          <RevealItem as="div" className="max-w-sm">
            <Link
              href="/"
              aria-label="AlarmTalk"
              className="flex items-center gap-2.5 whitespace-nowrap"
            >
              <BrandMark size={32} alt="" />
              <span translate="no" className="text-[16px] font-bold tracking-tight text-text">
                AlarmTalk
              </span>
            </Link>
            <p className="mt-4 text-[14px] leading-[1.65] text-text-muted">
              {t("tagline")}
            </p>
            <div className="mt-6">
              <LocaleSwitcher />
            </div>
          </RevealItem>

          <RevealItem as="div" className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            <div>
              <h2 className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                {t("product")}
              </h2>
              <ul className="mt-4 space-y-2.5 text-[14px]">
                <li>
                  <Link
                    href="/#voices"
                    className="whitespace-nowrap text-text-muted hover:text-text"
                  >
                    {t("linkVoices")}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/#how"
                    className="whitespace-nowrap text-text-muted hover:text-text"
                  >
                    {t("linkHow")}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/#faq"
                    className="whitespace-nowrap text-text-muted hover:text-text"
                  >
                    {t("linkFaq")}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/cheer"
                    className="whitespace-nowrap text-text-muted hover:text-text"
                  >
                    {t("linkCheer")}
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h2 className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                {t("company")}
              </h2>
              <ul className="mt-4 space-y-2.5 text-[14px]">
                <li>
                  <Link
                    href="/company"
                    className="whitespace-nowrap text-text-muted hover:text-text"
                  >
                    {t("linkAbout")}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/contact"
                    className="whitespace-nowrap text-text-muted hover:text-text"
                  >
                    {t("linkContact")}
                  </Link>
                </li>
              </ul>
            </div>
            <div>
              <h2 className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                {t("legal")}
              </h2>
              <ul className="mt-4 space-y-2.5 text-[14px]">
                <li>
                  <Link
                    href="/privacy"
                    className="whitespace-nowrap text-text-muted hover:text-text"
                  >
                    {t("linkPrivacy")}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/terms"
                    className="whitespace-nowrap text-text-muted hover:text-text"
                  >
                    {t("linkTerms")}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/account-deletion"
                    className="whitespace-nowrap text-text-muted hover:text-text"
                  >
                    {t("linkAccountDeletion")}
                  </Link>
                </li>
              </ul>
            </div>
          </RevealItem>
        </RevealGroup>

        <div className="mt-14 flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="whitespace-nowrap text-[12.5px] text-text-muted">
            © {year} <span translate="no">AlarmTalk</span> · {t("rights")}
          </p>
          <p className="whitespace-nowrap text-[12.5px] text-text-muted">
            {t("made")}
          </p>
        </div>
      </div>
    </footer>
  );
}
