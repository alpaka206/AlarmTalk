import { useTranslations } from "next-intl";
import { StoreBadges } from "../store-badges";
import { RevealGroup, RevealItem } from "../motion/reveal-group";
import { ScrollCue } from "../motion/scroll-cue";

/**
 * 히어로에는 제품 화면을 두지 않는다.
 *
 * 첫 화면이 할 일은 "이게 뭔지" 를 한 문장으로 넘기는 것이다. 폰 목업을 옆에 세우면
 * 시선이 둘로 갈리고, 정작 읽어야 할 문장이 화면 절반으로 줄어든다. 제품은 바로 다음
 * 구간에서 **스크롤과 함께** 나타난다 — 거기서는 화면이 주인공이라 크게 놓을 수 있다.
 */
export function Hero() {
  const t = useTranslations("hero");

  return (
    <section className="relative">
      <div className="mx-auto flex max-w-6xl flex-col items-center px-5 pb-24 pt-20 text-center md:px-8 lg:pb-32 lg:pt-28">
        <RevealGroup
          className="flex flex-col items-center"
          stagger={0.07}
          delay={0.05}
          trigger="mount"
        >
          <RevealItem as="p" className="eyebrow mb-5">
            {t("tag")}
          </RevealItem>

          <RevealItem as="h1" className="t-display max-w-4xl text-text">
            {t("headline")}
          </RevealItem>

          <RevealItem as="p" className="t-lead mt-7 max-w-2xl text-text-body">
            {t("description")}
          </RevealItem>

          <RevealItem as="div" className="mt-11">
            <StoreBadges />
          </RevealItem>
        </RevealGroup>

        <ScrollCue className="mt-20 hidden lg:block" />
      </div>
    </section>
  );
}
