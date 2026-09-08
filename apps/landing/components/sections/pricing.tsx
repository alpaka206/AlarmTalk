import { useTranslations } from "next-intl";
import { Reveal } from "../motion/reveal";
import { RevealGroup, RevealItem } from "../motion/reveal-group";

type PlanKey = "free" | "personal" | "couple" | "family";
const PLANS: readonly PlanKey[] = ["free", "personal", "couple", "family"];

/**
 * 요금 — **표를 만들지 않는다.**
 *
 * 표는 비교를 유도하고, 비교에서 무료 티어는 진다. 카드 넷을 나란히 두는 것도 같은
 * 이유로 안 된다 — 나란히 놓는 순간 그게 표다. 한 장의 카드에 행으로 쌓아서, 네 행의
 * 시각적 무게를 같게 둔다. '인기' 배지나 강조 테두리를 붙이는 순간 무료 행이
 * "모자란 것" 이 된다.
 *
 * 무료가 첫 행이고, 무료로 되는 것을 **다 나열한다**. 우리 무료는 실제로 넓다 —
 * 알람 무제한 + 기본 목소리 + 날씨·약 문구. 그런데 정작 사람들이 앱을 받는 이유인
 * "내 목소리" 는 유료다. 그 경계를 다운로드 뒤에 알게 되면 배신감이 된다.
 */
export function Pricing() {
  const t = useTranslations("pricing");

  return (
    <section id="pricing" className="relative">
      <div className="section-pad mx-auto max-w-6xl px-5 md:px-8">
        <Reveal className="mx-auto max-w-155 text-center">
          <p className="eyebrow mb-4 justify-center">{t("tag")}</p>
          <h2 className="t-h1 text-text">{t("headline")}</h2>
          <p className="t-body mt-5 text-text-body">{t("description")}</p>
        </Reveal>

        <RevealGroup
          as="ul"
          className="card mx-auto mt-12 max-w-3xl divide-y divide-line overflow-hidden"
          stagger={0.07}
        >
          {PLANS.map((plan) => (
            <RevealItem
              as="li"
              key={plan}
              className="grid gap-2 px-6 py-7 sm:grid-cols-[30%_1fr] sm:items-baseline sm:gap-6 sm:px-8"
            >
              <div>
                <h3 className="t-h3 text-text">{t(`plans.${plan}.name`)}</h3>
                {/* 금액은 숫자로만 강해진다 — 강조색을 쓰지 않는다. */}
                <p className="t-caption mt-1 tabular-nums text-text-muted">
                  {t(`plans.${plan}.price`)}
                </p>
              </div>
              <p className="t-body text-text-body">{t(`plans.${plan}.includes`)}</p>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal variant="caption" delay={0.1}>
          <p className="t-caption mx-auto mt-6 max-w-3xl text-text-muted">
            {t("note")}
          </p>
        </Reveal>
      </div>
    </section>
  );
}
