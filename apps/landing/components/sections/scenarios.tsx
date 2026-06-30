import { useTranslations } from "next-intl";
import { Reveal } from "../motion/reveal";
import { RevealGroup, RevealItem } from "../motion/reveal-group";

export function Scenarios() {
  const t = useTranslations("scenarios");
  const items = [0, 1, 2, 3] as const;

  return (
    <section id="voices" className="relative">
      <div className="mx-auto max-w-6xl px-5 py-24 md:px-8 lg:py-32">
        <div className="max-w-2xl">
          <Reveal
            as="h2"
            className="text-[34px] font-bold leading-[1.1] tracking-tight text-text sm:text-[44px]"
          >
            {t("headline")}
          </Reveal>
          <Reveal
            as="p"
            delay={0.08}
            className="mt-5 text-[16px] leading-[1.65] text-text-muted"
          >
            {t("description")}
          </Reveal>
        </div>

        <RevealGroup
          className="mt-12 grid gap-4 sm:grid-cols-2"
          stagger={0.08}
        >
          {items.map((i) => (
            <RevealItem
              as="article"
              key={i}
              className="card group relative p-7 transition hover:-translate-y-0.5 hover:shadow-(--shadow-elevated)"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex h-7 items-center whitespace-nowrap rounded-full border border-line bg-raised px-2.5 text-[11.5px] font-semibold text-text-muted">
                  {t(`items.${i}.tag`)}
                </span>
                {/* divider that wipes coral on hover */}
                <span className="relative h-px flex-1 overflow-hidden bg-line-soft">
                  <span className="absolute inset-0 origin-left scale-x-0 bg-accent transition-transform duration-300 ease-out group-hover:scale-x-100" />
                </span>
              </div>
              <h3 className="mt-5 text-[20px] font-bold leading-snug tracking-[-0.015em] text-text">
                {t(`items.${i}.title`)}
              </h3>
              <p className="mt-3 text-[15px] leading-[1.65] text-text-muted">
                {t(`items.${i}.body`)}
              </p>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
