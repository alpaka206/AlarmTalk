import { useTranslations } from "next-intl";
import { Reveal } from "../motion/reveal";
import { RevealGroup, RevealItem } from "../motion/reveal-group";

/**
 * 챕터 1 — **누구 목소리로 깨어나는가.**
 *
 * 예전에 이 자리에 있던 숫자 타일(무제한 / 4 / 0)은 사실이지만 '사양' 으로 읽혔다.
 * 근거 숫자(사용자 수·평점)가 없는 페이지에서 숫자를 크게 놓으면 벤치마크 표가 된다.
 * 대신 목소리의 출처 셋을 놓는다 — 이 앱이 파는 것은 기능 개수가 아니라 **대상**이다.
 * 각 칸은 [제목] + [두 줄 약속] 뿐이다 — 칸마다 작은 라벨을 얹으면 같은 리듬이 세 번 반복돼
 * 템플릿처럼 읽힌다. 방법은 뒤의 기능 섹션과 FAQ 가 맡는다.
 */
export function WhoseVoice() {
  const t = useTranslations("whoseVoice");
  const items = [0, 1, 2] as const;

  return (
    <section className="relative">
      <div className="section-pad mx-auto max-w-6xl px-5 md:px-8">
        <Reveal className="mx-auto max-w-155 text-center">
          <h2 className="t-h1 text-text">{t("headline")}</h2>
        </Reveal>
        <RevealGroup
          as="ul"
          className="mt-14 grid gap-12 md:grid-cols-3 md:gap-8 lg:gap-12"
          stagger={0.07}
        >
          {items.map((i) => (
            <RevealItem as="li" key={i} className="flex min-w-0 flex-col">
              <h3 className="t-h2 text-text [overflow-wrap:anywhere]">{t(`items.${i}.title`)}</h3>
              <p className="t-body mt-3 text-text-body [overflow-wrap:anywhere]">{t(`items.${i}.body`)}</p>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
