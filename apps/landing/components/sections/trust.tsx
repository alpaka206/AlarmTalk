import { useTranslations } from "next-intl";
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
      <div className="section-pad mx-auto max-w-6xl px-5 md:px-8">
        {/* 헤드라인은 선언 섹션으로 떼어냈다 — 이 자리에는 사실 셋만 남는다. */}
        <RevealGroup
          className="grid gap-px overflow-hidden rounded-3xl border border-line bg-line lg:grid-cols-3"
          stagger={0.07}
        >
          {items.map((i) => {
            const metric = parseMetric(t(`items.${i}.metric`));
            return (
              <RevealItem
                key={i}
                className="flex flex-col gap-4 bg-surface p-7 lg:p-8"
              >
                <div className="flex items-baseline gap-1.5">
                  {/* 강조색을 쓰지 않는다 — 56px 숫자는 크기로 이미 충분히 강하다.
                      브랜드색 예산은 아이브로와 CTA 로 간다. */}
                  <span className="t-metric whitespace-nowrap text-text">
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
                <p className="t-body text-text-body">
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
