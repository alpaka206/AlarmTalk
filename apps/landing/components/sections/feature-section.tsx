import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Reveal } from "../motion/reveal";
import { RevealGroup, RevealItem } from "../motion/reveal-group";

type Props = {
  namespace: "voice" | "shared" | "language";
  reverse?: boolean;
  visual: React.ReactNode;
  id?: string;
  /** 교대 배경. 카드를 얹을 때는 반드시 surface(흰색)로 — raised 는 대비 1.017 이라 안 보인다. */
  alt?: boolean;
};

export function FeatureSection({ namespace, reverse, visual, id, alt }: Props) {
  const t = useTranslations(namespace);

  return (
    <section
      id={id}
      className={`relative ${alt ? "bg-bg-alt" : ""}`}
    >
      <div className="section-pad mx-auto max-w-6xl px-5 md:px-8">
        <div
          className={`grid items-center gap-12 lg:grid-cols-2 lg:gap-16 ${
            reverse ? "lg:[direction:rtl]" : ""
          }`}
        >
          <div className={`${reverse ? "lg:[direction:ltr]" : ""}`}>
            {/* 서사 단계(헤드 → 시각물)는 stagger 가 아니라 명시 delay 로 벌린다.
                목록처럼 같은 종류가 여럿일 때만 촘촘한 stagger 가 맞다. */}
            <RevealGroup stagger={0.07}>
              {/* 줄바꿈은 JSON 의 `\n` 이 정한다 — 하드코딩 <br/> 은 로케일마다 다른
                  위치에서 끊어야 하는 영어·일본어 어순을 못 따라간다. */}
              <RevealItem as="h2" className="t-h1 text-text">
                {t("headline")}
              </RevealItem>
              <RevealItem as="p" className="t-body mt-6 max-w-xl text-text-body">
                {t("description")}
              </RevealItem>
            </RevealGroup>

            <RevealGroup as="ul" className="mt-7 space-y-3" stagger={0.07}>
              {(["bullet1", "bullet2", "bullet3"] as const).map((key) => (
                <RevealItem as="li" key={key} className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  <span className="t-body text-text-body">{t(key)}</span>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>

          {/* 시각물은 컨테이너 밖으로 조금 흘러나간다 — 세로 폰은 이미 시선을 많이
              먹으므로 5.5% 가 상한이다. */}
          <Reveal
            variant="heavy"
            delay={0.24}
            className={`flex items-center justify-center ${
              reverse
                ? "lg:[direction:ltr] lg:-ml-16"
                : "lg:-mr-16"
            }`}
          >
            {visual}
          </Reveal>
        </div>
      </div>
    </section>
  );
}
