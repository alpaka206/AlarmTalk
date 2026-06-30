import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Reveal } from "../motion/reveal";
import { RevealGroup, RevealItem } from "../motion/reveal-group";

type Props = {
  namespace: "voice" | "shared" | "language";
  reverse?: boolean;
  visual: React.ReactNode;
  id?: string;
};

export function FeatureSection({ namespace, reverse, visual, id }: Props) {
  const t = useTranslations(namespace);

  return (
    <section id={id} className="relative">
      <div className="mx-auto max-w-6xl px-5 py-20 md:px-8 lg:py-28">
        <div
          className={`grid items-center gap-12 lg:grid-cols-2 lg:gap-16 ${
            reverse ? "lg:[direction:rtl]" : ""
          }`}
        >
          <div className={`${reverse ? "lg:[direction:ltr]" : ""}`}>
            <RevealGroup stagger={0.08}>
              <RevealItem
                as="h2"
                className="text-[34px] font-bold leading-[1.1] tracking-tight text-text sm:text-[44px]"
              >
                {t("headline1")}
                <br />
                {t("headline2")}
              </RevealItem>
              <RevealItem
                as="p"
                className="mt-6 max-w-xl text-[16px] leading-[1.7] text-text-muted"
              >
                {t("description")}
              </RevealItem>
            </RevealGroup>

            <RevealGroup as="ul" className="mt-7 space-y-3" stagger={0.07}>
              {(["bullet1", "bullet2", "bullet3"] as const).map((key) => (
                <RevealItem
                  as="li"
                  key={key}
                  className="flex items-start gap-3"
                >
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  <span className="text-[14.5px] leading-[1.6] text-text">
                    {t(key)}
                  </span>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>

          <Reveal
            variant="focus"
            className={`flex items-center justify-center ${
              reverse ? "lg:[direction:ltr]" : ""
            }`}
          >
            {visual}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
