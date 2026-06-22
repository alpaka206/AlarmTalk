import { Quote } from "lucide-react";
import { useTranslations } from "next-intl";
import { Reveal } from "../motion/reveal";
import { RevealGroup, RevealItem } from "../motion/reveal-group";

type QuoteItem = { body: string; author: string; role: string };

export function Quotes() {
  const t = useTranslations("quotes");
  const items = t.raw("items") as QuoteItem[];

  return (
    <section className="relative">
      <Reveal variant="wipe" as="div" className="hairline" />
      <div className="mx-auto max-w-6xl px-5 py-24 md:px-8 lg:py-28">
        <div className="max-w-3xl">
          <Reveal as="span" className="eyebrow">
            {t("eyebrow")}
          </Reveal>
          <Reveal
            as="h2"
            delay={0.06}
            className="mt-6 text-[32px] font-bold leading-[1.15] tracking-[-0.02em] text-text sm:text-[40px]"
          >
            {t("headline")}
          </Reveal>
          <Reveal
            as="p"
            delay={0.12}
            className="mt-5 text-[16px] leading-[1.65] text-text-muted"
          >
            {t("description")}
          </Reveal>
        </div>

        <RevealGroup as="ul" className="mt-12 grid gap-4 lg:grid-cols-3" stagger={0.1}>
          {items.map((item, i) => (
            <RevealItem
              as="li"
              key={`${item.author}-${i}`}
              className="card relative flex flex-col p-7 lg:p-8"
            >
              <Quote className="h-5 w-5 text-accent" aria-hidden="true" />
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
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal
          as="p"
          delay={0.1}
          className="mt-10 text-[12.5px] text-text-faint"
        >
          {t("disclaimer")}
        </Reveal>
      </div>
    </section>
  );
}
