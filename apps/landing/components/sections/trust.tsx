import { useTranslations } from "next-intl";
import { Reveal } from "../motion/reveal";
import { RevealGroup, RevealItem } from "../motion/reveal-group";
import { CountUp } from "../motion/count-up";

type Metric =
  | { mode: "number" | "odometer"; to: number; suffix: string }
  | { mode: "text"; text: string };

// Split a localized metric ("60초" / "60s" / "TTS" / "0") into a number + its
// locale suffix so the count animates while the unit stays in i18n.
function parseMetric(raw: string): Metric {
  const m = raw.match(/^(\d+)(.*)$/);
  if (!m) return { mode: "text", text: raw };
  const to = parseInt(m[1], 10);
  return { mode: to === 0 ? "odometer" : "number", to, suffix: m[2] };
}

export function Trust() {
  const t = useTranslations("trust");
  const items = [0, 1, 2] as const;

  return (
    <section className="relative">
      <div className="mx-auto max-w-6xl px-5 py-16 md:px-8 lg:py-20">
        <Reveal
          as="h2"
          className="max-w-2xl whitespace-pre-line text-[34px] font-bold leading-[1.1] tracking-tight text-text sm:text-[44px]"
        >
          {t("headline")}
        </Reveal>
        {/* coral wipe underline — ties Trust to the voice-spine */}
        <Reveal
          as="div"
          variant="wipe"
          delay={0.15}
          className="mt-5 h-0.5 w-14 rounded-full bg-accent"
        />

        <RevealGroup
          className="mt-10 grid gap-px overflow-hidden rounded-3xl border border-line bg-line lg:grid-cols-3"
          stagger={0.08}
        >
          {items.map((i) => {
            const metric = parseMetric(t(`items.${i}.metric`));
            return (
              <RevealItem
                key={i}
                className="flex flex-col gap-4 bg-surface p-7 lg:p-8"
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="whitespace-nowrap text-[48px] font-bold leading-none tracking-[-0.03em] text-accent sm:text-[56px]">
                    {metric.mode === "text" ? (
                      <CountUp mode="text" text={metric.text} durationMs={700} />
                    ) : (
                      <CountUp
                        mode={metric.mode}
                        to={metric.to}
                        suffix={metric.suffix}
                        durationMs={900}
                      />
                    )}
                  </span>
                  <span className="whitespace-nowrap text-[14px] font-semibold text-text-muted">
                    {t(`items.${i}.title`)}
                  </span>
                </div>
                <p className="text-[14.5px] leading-[1.65] text-text-muted">
                  {t(`items.${i}.body`)}
                </p>
              </RevealItem>
            );
          })}
        </RevealGroup>
      </div>
    </section>
  );
}
