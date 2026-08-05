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
        {/* 헤드라인은 선언 섹션으로 떼어냈다 — 이 자리에는 사실 셋만 남는다.
            칸을 테두리로 가르지 않는다. 흰 바닥에서는 선을 긋는 것보다 여백으로
            떨어뜨리는 쪽이 조용하고, 숫자 셋이 각자 서 있는 편이 표처럼 안 읽힌다. */}
        <RevealGroup
          className="grid gap-12 md:grid-cols-3 md:gap-8 lg:gap-12"
          stagger={0.07}
        >
          {items.map((i) => {
            const metric = parseMetric(t(`items.${i}.metric`));
            return (
              <RevealItem key={i} className="flex flex-col">
                {/* 강조색을 쓰지 않는다 — 숫자는 크기와 굵기로 이미 충분히 강하다.
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
                <span className="t-h3 mt-3 text-text">
                  {t(`items.${i}.title`)}
                </span>
                <p className="t-body mt-2 text-text-body">
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
