import { useTranslations } from "next-intl";
import { Reveal } from "../motion/reveal";

/**
 * 히어로 바로 다음에 오는 입장 표명.
 *
 * 이 자리에 보통은 숫자를 놓는다(다운로드 수·사용자 수·평점). **우리에겐 그 숫자가
 * 없고**, 작은 숫자는 큰 숫자 옆에서 지기만 한다. 대신 경쟁 프레임을 갈아 끼우는
 * 문장을 놓는다 — "더 센 알람" 이라는 잣대 위에서는 기능 개수로 지지만, 우리가 파는
 * 것은 개수가 아니라 대상이다. 기능 설명보다 앞이어야 하는 이유가 그것이다.
 */
export function Declare() {
  const t = useTranslations("declare");

  return (
    <section className="bg-bg-alt">
      <div className="section-pad mx-auto max-w-6xl px-5 md:px-8">
        <Reveal className="mx-auto max-w-155 text-center">
          <h2 className="t-h1 text-text">{t("headline")}</h2>
          <p className="t-lead mt-6 text-text-body">{t("body")}</p>
        </Reveal>
      </div>
    </section>
  );
}
