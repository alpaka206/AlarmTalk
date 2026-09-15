import { Check, Minus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Reveal } from "./motion/reveal";
import { RevealGroup, RevealItem } from "./motion/reveal-group";

/**
 * 요금 비교표 — 무료 · 개인 · 커플 · 가족을 **기능 행 × 요금제 열**로 놓는다(2026-09-15 지시,
 * 홈 안의 네 행짜리 카드에서 별도 페이지의 표로).
 *
 * 표는 비교를 유도하고 비교에서 무료는 보통 진다. 그래서 무료 열을 **첫 열**에 두고, 기본
 * 묶음(알람·기본 목소리·고르는 문구·언어)은 네 열 전부 ✓ 라 "무료가 넓다" 가 표에서도
 * 읽히게 한다. '인기' 배지나 강조 열은 두지 않는다 — 붙이는 순간 나머지가 모자란 것이 된다.
 *
 * 값은 셋뿐이다: 포함(✓) · 미포함(–) · 짧은 값(무제한, 한 달에 한 번, 본인 포함 N명).
 * 사실은 요금 원장(packages/backend 의 plans 시드)과 FAQ 가 말하는 그대로다 — 여기서 새
 * 숫자를 짓지 않는다.
 *
 * 폭이 좁으면 표는 못 쓴다(다섯 열이 320px 에 안 들어간다). md 미만에서는 같은 데이터를
 * 요금제별 카드로 세로로 편다. 둘은 display 로 갈라 스크린리더에는 하나만 읽힌다.
 */

const PLANS = ["free", "personal", "couple", "family"] as const;
type PlanKey = (typeof PLANS)[number];

type Cell = boolean | "unlimited" | "monthly" | "people2" | "people5";

type Row = { key: string; cells: Record<PlanKey, Cell> };
type Group = { key: "basics" | "voice" | "together"; rows: Row[] };

const GROUPS: readonly Group[] = [
  {
    key: "basics",
    rows: [
      { key: "alarms", cells: { free: "unlimited", personal: "unlimited", couple: "unlimited", family: "unlimited" } },
      { key: "builtin", cells: { free: true, personal: true, couple: true, family: true } },
      { key: "presets", cells: { free: true, personal: true, couple: true, family: true } },
      { key: "languages", cells: { free: true, personal: true, couple: true, family: true } },
    ],
  },
  {
    key: "voice",
    rows: [
      { key: "customText", cells: { free: false, personal: true, couple: true, family: true } },
      { key: "myVoice", cells: { free: false, personal: "monthly", couple: "monthly", family: "monthly" } },
    ],
  },
  {
    key: "together",
    rows: [
      { key: "sharing", cells: { free: false, personal: false, couple: "people2", family: "people5" } },
      { key: "setOthers", cells: { free: false, personal: false, couple: true, family: true } },
    ],
  },
];

function CellMark({ cell }: { cell: Cell }) {
  const t = useTranslations("pricing");
  if (cell === true) {
    return (
      <span className="inline-grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-accent">
        <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
        <span className="sr-only">{t("a11y.included")}</span>
      </span>
    );
  }
  if (cell === false) {
    return (
      <span className="inline-grid h-6 w-6 place-items-center text-text-muted">
        <Minus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
        <span className="sr-only">{t("a11y.notIncluded")}</span>
      </span>
    );
  }
  return <span className="t-body text-text">{t(`values.${cell}`)}</span>;
}

export function PricingTable() {
  const t = useTranslations("pricing");

  return (
    <>
      {/* md 이상: 표. 열 폭은 첫 열(기능 이름)이 넓고 요금제 넷이 같게. */}
      <Reveal className="card hidden overflow-hidden md:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{t("a11y.caption")}</caption>
          <colgroup>
            <col className="w-[34%]" />
            {PLANS.map((p) => (
              <col key={p} className="w-[16.5%]" />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-6 py-6 lg:px-8">
                <span className="sr-only">{t("a11y.planColumn")}</span>
              </th>
              {PLANS.map((plan) => (
                <th key={plan} scope="col" className="px-3 py-6 text-center align-top">
                  <span className="t-h3 block text-text">{t(`plans.${plan}.name`)}</span>
                  {/* 금액은 숫자로만 강해진다 — 강조색을 쓰지 않는다. */}
                  <span className="t-caption mt-1 block tabular-nums text-text-muted">
                    {t(`plans.${plan}.price`)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          {GROUPS.map((group) => (
            <tbody key={group.key}>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={PLANS.length + 1}
                  className="t-caption border-y border-line bg-bg-alt px-6 py-3 font-semibold text-text lg:px-8"
                >
                  {t(`groups.${group.key}`)}
                </th>
              </tr>
              {group.rows.map((row, i) => (
                <tr key={row.key} className={i > 0 ? "border-t border-line" : ""}>
                  <th scope="row" className="t-body px-6 py-4 font-medium text-text-body lg:px-8">
                    {t(`rows.${row.key}`)}
                  </th>
                  {PLANS.map((plan) => (
                    <td key={plan} className="px-3 py-4 text-center align-middle">
                      <CellMark cell={row.cells[plan]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </Reveal>

      {/* md 미만: 요금제별 카드. 같은 데이터, 같은 순서. */}
      <RevealGroup as="ul" className="grid gap-4 md:hidden" stagger={0.07}>
        {PLANS.map((plan) => (
          <RevealItem as="li" key={plan} className="card p-6">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="t-h3 text-text">{t(`plans.${plan}.name`)}</h3>
              <p className="t-caption tabular-nums text-text-muted">{t(`plans.${plan}.price`)}</p>
            </div>
            <ul className="mt-5 divide-y divide-line">
              {GROUPS.flatMap((g) => g.rows).map((row) => {
                const cell = row.cells[plan];
                return (
                  <li
                    key={row.key}
                    className={`flex items-center justify-between gap-4 py-3 ${
                      cell === false ? "text-text-muted" : "text-text-body"
                    }`}
                  >
                    <span className="t-body">{t(`rows.${row.key}`)}</span>
                    <span className="shrink-0 text-right">
                      <CellMark cell={cell} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </RevealItem>
        ))}
      </RevealGroup>
    </>
  );
}
