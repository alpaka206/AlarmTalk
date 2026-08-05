import { useTranslations } from "next-intl";
import { StoreBadges } from "../store-badges";
import { Reveal } from "../motion/reveal";

/**
 * 끝까지 읽은 사람을 다시 위로 스크롤시키지 않는다 — 지금까지 이 자리가 비어 있었다.
 *
 * CTA 는 네 곳뿐이다(헤더 · 히어로 · 여기 · 푸터). 상시 플로팅 버튼은 두지 않는다:
 * 모바일에서 화면 아래 떠 있는 버튼은 우리 스크린샷 속 앱 탭바와 겹쳐 보인다.
 */
export function FinalCta() {
  const t = useTranslations("finalCta");

  return (
    <section className="bg-bg-alt">
      <div className="section-pad mx-auto max-w-6xl px-5 md:px-8">
        <Reveal className="mx-auto flex max-w-155 flex-col items-center text-center">
          <h2 className="t-h1 text-text">{t("headline")}</h2>
          <p className="t-lead mt-5 text-text-body">{t("body")}</p>
          <div className="mt-9">
            <StoreBadges />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
