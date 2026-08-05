import { useTranslations } from "next-intl";
import { DeviceShot } from "../device-shot";
import { Reveal } from "../motion/reveal";
import { RevealGroup, RevealItem } from "../motion/reveal-group";

/**
 * 페이지에서 **딱 한 번** 쓰는 어두운 블록.
 *
 * 어두운 이유가 "스크린샷이 많아서" 이면 안 된다. 서사가 요구해야 한다 — 목소리를
 * 맡긴다는 건 밤에 하는 결정이고, 목소리를 복제하는 앱에서 이건 1순위 거절 사유다.
 * 그걸 FAQ 두 번째 답변에 두면 이미 겁먹고 떠난 사람은 읽지 못한다.
 *
 * 덤으로, 컨테이너가 어두우면 딥네이비 스크린샷에 **가장자리 자체가 생기지 않는다.**
 * 밝은 페이지에 어두운 UI 를 앉히는 문제를 그 자리에서는 문제를 없애서 푼다.
 */
export function Privacy() {
  const t = useTranslations("privacy");
  const points = ["point1", "point2", "point3"] as const;

  return (
    <section className="section-ink bg-ink">
      <div className="section-pad mx-auto max-w-6xl px-5 md:px-8">
        <div className="grid items-center gap-14 lg:grid-cols-2 lg:gap-16">
          <div>
            <RevealGroup stagger={0.07}>
              <RevealItem as="p" className="eyebrow mb-4">
                {t("tag")}
              </RevealItem>
              <RevealItem as="h2" className="t-h1 text-white">
                {t("headline")}
              </RevealItem>
              {/* 어두운 바닥에서는 얇은 획이 번져 보여 굵기를 한 단 올린다.
                  가변 폰트라 550 은 추가 파일 없이 공짜다. */}
              <RevealItem
                as="p"
                className="t-body mt-6 max-w-xl text-ink-body [font-weight:550]"
              >
                {t("body")}
              </RevealItem>
            </RevealGroup>

            {/* 어두운 섹션의 항목에는 배경을 주지 않는다 — 여백으로만 나눈다. */}
            <RevealGroup as="ul" className="mt-9 space-y-5" stagger={0.07}>
              {points.map((key) => (
                <RevealItem as="li" key={key} className="max-w-xl">
                  <p className="t-h3 text-white">{t(`${key}.title`)}</p>
                  <p className="t-body mt-1.5 text-ink-body [font-weight:550]">
                    {t(`${key}.body`)}
                  </p>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>

          <Reveal variant="heavy" delay={0.24} className="flex justify-center">
            {/* '공유받은 목소리' 그룹이 보이는 화면 — 그룹 밖으로 안 나간다는 증거다. */}
            <DeviceShot name="voices" />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
