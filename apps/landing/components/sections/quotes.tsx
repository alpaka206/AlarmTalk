import { Quote } from "lucide-react";
import { useTranslations } from "next-intl";

type QuoteItem = { body: string; author: string; role: string };

export function Quotes() {
  const t = useTranslations("quotes");
  const items = t.raw("items") as QuoteItem[];

  return (
    <section className="relative">
      <div className="hairline" />
      <div className="mx-auto max-w-6xl px-5 py-24 md:px-8 lg:py-28">
        <div className="max-w-3xl">
          <span className="eyebrow">{t("eyebrow")}</span>
          <h2 className="mt-6 text-[32px] font-bold leading-[1.15] tracking-[-0.02em] text-text sm:text-[40px]">
            {t("headline")}
          </h2>
          <p className="mt-5 text-[16px] leading-[1.65] text-text-muted">
            {t("description")}
          </p>
        </div>

        <ul className="mt-12 grid gap-4 lg:grid-cols-3">
          {items.map((item, i) => (
            <li
              key={`${item.author}-${i}`}
              className="card relative flex flex-col p-7 lg:p-8"
            >
              <Quote
                className="h-5 w-5 text-accent"
                aria-hidden="true"
              />
              <p className="mt-5 text-[15.5px] leading-[1.7] text-text">
                {item.body}
              </p>
              <div className="mt-7 flex items-center gap-3 border-t border-line-soft pt-5">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-[12px] font-bold text-accent">
                  {item.author.slice(0, 1)}
                </span>
                <div className="flex flex-col leading-tight">
                  <span className="text-[13px] font-semibold text-text">
                    {item.author}
                  </span>
                  <span className="text-[12px] text-text-faint">
                    {item.role}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-[12.5px] text-text-faint">{t("disclaimer")}</p>
      </div>
    </section>
  );
}
