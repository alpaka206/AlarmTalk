import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { BrandMark } from "../brand-mark";
import { LocaleSwitcher } from "../locale-switcher";

export function SiteFooter() {
  const t = useTranslations("footer");
  const year = new Date().getFullYear();

  return (
    <footer className="relative">
      <div className="hairline" />
      <div className="mx-auto max-w-6xl px-5 py-14 md:px-8 lg:py-20">
        <div className="flex flex-col gap-12 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-sm">
            <Link
              href="/"
              aria-label="VocaWake"
              className="flex items-center gap-2.5 whitespace-nowrap"
            >
              <BrandMark size={32} className="rounded-[8px]" />
              <span className="text-[16px] font-bold tracking-tight text-text">
                VocaWake
              </span>
            </Link>
            <p className="mt-4 text-[14px] leading-[1.65] text-text-muted">
              {t("tagline")}
            </p>
            <div className="mt-6">
              <LocaleSwitcher />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            <div>
              <p className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em] text-text-faint">
                {t("product")}
              </p>
              <ul className="mt-4 space-y-2.5 text-[14px]">
                <li>
                  <a
                    href="#voices"
                    className="whitespace-nowrap text-text-muted hover:text-text"
                  >
                    {t("linkVoices")}
                  </a>
                </li>
                <li>
                  <a
                    href="#how"
                    className="whitespace-nowrap text-text-muted hover:text-text"
                  >
                    {t("linkHow")}
                  </a>
                </li>
                <li>
                  <a
                    href="#faq"
                    className="whitespace-nowrap text-text-muted hover:text-text"
                  >
                    {t("linkFaq")}
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <p className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em] text-text-faint">
                {t("company")}
              </p>
              <ul className="mt-4 space-y-2.5 text-[14px]">
                <li>
                  <a
                    href="https://github.com/perso-devrel/voice_alarm"
                    target="_blank"
                    rel="noreferrer"
                    className="whitespace-nowrap text-text-muted hover:text-text"
                  >
                    {t("linkGithub")}
                  </a>
                </li>
                <li>
                  <a
                    href="mailto:hello@vocawake.com"
                    className="whitespace-nowrap text-text-muted hover:text-text"
                  >
                    {t("linkContact")}
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <p className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.12em] text-text-faint">
                {t("legal")}
              </p>
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
              </ul>
            </div>
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="whitespace-nowrap text-[12.5px] text-text-faint">
            © {year} VocaWake · {t("rights")}
          </p>
          <p className="whitespace-nowrap text-[12.5px] text-text-faint">
            {t("made")}
          </p>
        </div>
      </div>
    </footer>
  );
}
