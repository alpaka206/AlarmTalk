import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { BrandMark } from "../brand-mark";
import { RevealGroup, RevealItem } from "../motion/reveal-group";

export function SiteFooter() {
  const t = useTranslations("footer");
  const year = new Date().getFullYear();

  return (
    <footer className="relative">
      <div className="hairline" />
      <div className="mx-auto max-w-site px-5 py-14 md:px-8 lg:py-20">
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
          </RevealItem>

          <RevealItem as="div" className="grid grid-cols-2 gap-10">
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
                    href="/pricing"
                    className="whitespace-nowrap text-text-muted hover:text-text"
                  >
                    {t("linkPricing")}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/faq"
                    className="whitespace-nowrap text-text-muted hover:text-text"
                  >
                    {t("linkFaq")}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/event"
                    className="whitespace-nowrap text-text-muted hover:text-text"
                  >
                    {t("linkEvent")}
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

        <div className="mt-14 flex flex-col gap-3 border-t border-line pt-6">
          {/* 사업자 정보 — 값의 출처는 docs/legal/privacy-policy.ko.md 머리말이다. 거기와 어긋나면 그쪽이 맞다. */}
          <p className="text-[12.5px] leading-[1.7] text-text-muted [overflow-wrap:anywhere]">
            <span className="sr-only">{t("businessLabel")}: </span>
            {t("business")}
          </p>
          <p className="whitespace-nowrap text-[12.5px] text-text-muted">
            © {year} <span translate="no">AlarmTalk</span> · {t("rights")}
          </p>
        </div>
      </div>
    </footer>
  );
}
