import { useTranslations } from "next-intl";
import { Reveal } from "../motion/reveal";
import { RevealGroup, RevealItem } from "../motion/reveal-group";

export function Faq() {
  const t = useTranslations("faq");
  const items = (t.raw("items") as unknown[]).map((_, i) => i);

  return (
    <section id="faq" className="relative">
      <div className="mx-auto max-w-4xl px-5 py-24 md:px-8 lg:py-32">
        <Reveal
          as="h2"
          className="text-[34px] font-bold leading-[1.1] tracking-tight text-text sm:text-[44px]"
        >
          {t("headline")}
        </Reveal>

        <RevealGroup
          className="mt-12 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-surface"
          stagger={0.06}
        >
          {items.map((i) => (
            <RevealItem
              as="details"
              key={i}
              className="group p-6 transition open:bg-raised md:p-7"
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6">
                <span className="text-[16px] font-semibold text-text sm:text-[17px]">
                  {t(`items.${i}.q`)}
                </span>
                <span
                  aria-hidden="true"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-text-muted transition group-open:rotate-45 group-open:border-accent group-open:text-accent"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 14 14"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M7 1.5V12.5M1.5 7H12.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
              </summary>
              <p className="mt-4 max-w-3xl text-[14.5px] leading-[1.65] text-text-muted group-open:animate-fadeup">
                {t(`items.${i}.a`)}
              </p>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
