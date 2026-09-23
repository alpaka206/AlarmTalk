import { useTranslations } from "next-intl";
import { Reveal } from "../motion/reveal";
import { RevealGroup, RevealItem } from "../motion/reveal-group";
import { StoreBadges } from "../store-badges";

/**
 * 자주 묻는 질문 — 홈에서 떼어 낸 별도 페이지의 본문(2026-09-15 지시). 페이지 제목이라
 * h1 이고, 질문 하나하나가 h3 인 위계는 그대로다(h2 는 없다 — 목록 하나뿐이라 사이 단계가 없다).
 *
 * 목록 아래 스토어 배지는 **'어떤 기기를 지원하나요' 답이 가리키는 버튼**이다. 그 답은 받는
 * 곳을 "이 페이지의 Google Play · App Store 버튼" 으로 넘긴다(스토어가 내려가도 참인 문장 —
 * `store-badges.tsx` 주석). 그런데 이 페이지에는 원래 배지가 없었다: 헤더의 배지는
 * `MobileMenu` 안에만 있고 그 메뉴는 `lg:hidden` 이라, **데스크톱에서는 가리킬 버튼이 없는
 * 답**이 됐다(코덱스 #799). 그래서 배지를 이 컴포넌트에 둔다 — 답과 버튼이 늘 같이 다닌다.
 */
export function Faq() {
  const t = useTranslations("faq");
  const items = (t.raw("items") as unknown[]).map((_, i) => i);

  return (
    <section id="faq" className="relative">
      <div className="mx-auto max-w-site px-5 pb-24 pt-16 md:px-8 lg:pb-32 lg:pt-24">
        <Reveal as="h1" className="t-display text-text">
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
              id={`faq-${i}`}
              className="group p-6 transition-[background-color] duration-150 ease-[var(--ease-ui)] open:bg-raised md:p-7"
            >
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6">
                <h3 className="min-w-0 text-[16px] font-semibold text-text [overflow-wrap:anywhere] sm:text-[17px]">
                  {t(`items.${i}.q`)}
                </h3>
                <span
                  aria-hidden="true"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-text-muted transition-[transform,color,border-color] duration-150 ease-[var(--ease-ui)] group-open:rotate-45 group-open:border-accent group-open:text-accent"
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

        <Reveal className="mt-12">
          <StoreBadges />
        </Reveal>
      </div>
    </section>
  );
}
