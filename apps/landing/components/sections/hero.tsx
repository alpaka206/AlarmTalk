import { useTranslations } from "next-intl";
import { StoreBadges } from "../store-badges";
import { VoicePreview } from "../voice-preview";
import { RevealGroup, RevealItem } from "../motion/reveal-group";
import { CyclingWord } from "../motion/cycling-word";

/**
 * 히어로에는 제품 화면을 두지 않는다.
 *
 * 첫 화면이 할 일은 "이게 뭔지" 를 한 문장으로 넘기는 것이다. 폰 목업을 옆에 세우면
 * 시선이 둘로 갈리고, 정작 읽어야 할 문장이 화면 절반으로 줄어든다. 제품은 바로 다음
 * 구간에서 **스크롤과 함께** 나타난다 — 거기서는 화면이 주인공이라 크게 놓을 수 있다.
 */
export function Hero() {
  const t = useTranslations("hero");
  // 돌아가는 자리는 '누구' 뿐이다 — 엄마 → 최애 → 딸 → 그 사람. 기능을 돌리지 않는다.
  const who = t.raw("who") as string[];

  return (
    <section className="relative">
      <div className="mx-auto flex max-w-6xl flex-col items-center px-5 pb-24 pt-20 text-center md:px-8 lg:pb-32 lg:pt-28">
        <RevealGroup
          className="flex flex-col items-center"
          stagger={0.07}
          delay={0.05}
          trigger="mount"
        >
          <RevealItem as="h1" className="t-display max-w-4xl text-pretty text-text">
            {t.rich("headline", {
              who: () => <CyclingWord words={who} className="text-accent" />,
            })}
          </RevealItem>

          <RevealItem as="p" className="t-lead mt-7 max-w-3xl text-balance text-text-body">
            {t("description")}
          </RevealItem>

          {/* 소리가 곧 제품이다 — 설명을 다 읽기 전에 들을 수 있어야 한다. 스토어 배지보다
              위에 두는 이유: 듣고 나서 받는 순서가 자연스럽고, 안 듣고 받는 사람은 어차피
              배지를 찾아 내려온다. */}
          <RevealItem as="div" className="mt-10 flex w-full justify-center">
            <VoicePreview />
          </RevealItem>

          <RevealItem as="div" className="mt-9">
            <StoreBadges />
          </RevealItem>
        </RevealGroup>

      </div>
    </section>
  );
}
