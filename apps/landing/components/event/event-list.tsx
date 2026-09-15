import type { ComponentType } from "react";
import { ArrowRight, Heart, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { EVENTS, type EventEntry } from "@/lib/events";
import { CELEBRITIES } from "@/components/event/event-catalog";
import { Reveal } from "@/components/motion/reveal";
import { RevealGroup, RevealItem } from "@/components/motion/reveal-group";

/**
 * 이벤트 목록, 포스터 판. 항목 하나가 **포스터 한 장**이다: 왼쪽에 큰 번호와 제목, 오른쪽에
 * 그 이벤트의 본질을 보여 주는 미리보기, 아래에 들어가는 손잡이 하나. 설명 문장은 없다
 * (2026-09-15 오너 지시). 무엇인지는 제목이, 어떤 느낌인지는 미리보기가 말한다.
 *
 * 왜 포스터인가: 이벤트는 1, 2, 3 … 으로 쌓이지만 지금은 하나뿐이다. 한 줄짜리 행으로 그리면
 * 목록이 아니라 빈 목록의 첫 줄로 읽힌다. 카드 한 장이 화면을 채울 만큼 크면 하나여도
 * 초라하지 않고, 둘 이상이면 같은 카드가 세로로 쌓여 그대로 목록이 된다(`ol`).
 *
 * 카드 전체가 링크 하나다. 안에 버튼을 두지 않는다(중첩 인터랙티브 금지). 미리보기 속
 * 버튼 모양은 장식이라 `aria-hidden` 으로 통째로 가린다. 스크린리더는
 * "이벤트 1. <제목> <참여하기>" 한 문장을 듣는다.
 *
 * 색·반경은 `globals.css` 토큰만 쓴다. 미리보기 바닥은 `raised`(gray-100)다. 호버 때 카드
 * 바닥이 `bg-alt`(gray-50)로 바뀌어도 한 단 더 어두워서 무대와 카드가 계속 갈린다.
 */

/**
 * 이벤트마다 그 이벤트를 보여 주는 미리보기. `EventEntry["key"]` 로 잠가 두었으므로
 * `lib/events.ts` 에 이벤트를 더하면 여기도 채워야 컴파일된다. 빈 자리를 허용하지 않는
 * 이유: 미리보기 없는 포스터는 제목 한 줄짜리 행으로 되돌아간다.
 */
const PREVIEWS: Record<EventEntry["key"], ComponentType> = {
  cheer: VoiceMessagePreview,
};

/**
 * 데스크톱에서 오른쪽 미리보기 열은 26rem 고정이다. 남는 폭은 전부 제목 쪽으로 간다.
 * 제목이 넓게 쉬어야 포스터고, 미리보기 열을 비율로 두면 넓은 화면에서 빈 회색이 커진다.
 * 그 아래(lg 미만)에서는 세로로 쌓인다: 번호·제목 → 미리보기 → 손잡이. 손잡이는 DOM 에서
 * 마지막이라 모바일에서는 카드 맨 아래, 데스크톱에서는 grid 배치로 왼쪽 열 바닥에 앉는다.
 */
const POSTER_GRID =
  "lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:grid-rows-[minmax(0,1fr)_auto]";

export function EventList() {
  const t = useTranslations("eventList");
  return (
    <section className="relative">
      <div className="mx-auto max-w-site px-5 pb-24 pt-16 md:px-8 lg:pb-32 lg:pt-24">
        <Reveal as="h1" className="t-display text-text" trigger="mount">
          {t("headline")}
        </Reveal>

        {/* 첫 포스터가 곧 첫 화면이라 관찰자에 걸지 않고 mount 로 띄운다. 제목보다 한 박자 늦게. */}
        <RevealGroup
          as="ol"
          className="mt-10 flex flex-col gap-6 lg:mt-14"
          stagger={0.09}
          delay={0.15}
          trigger="mount"
        >
          {EVENTS.map((event) => {
            const Preview = PREVIEWS[event.key];
            return (
              <RevealItem as="li" key={event.id}>
                <Link
                  href={`/event/${event.id}`}
                  className={`card card-interactive grid overflow-hidden ${POSTER_GRID}`}
                >
                  <div className="px-6 pb-6 pt-6 sm:px-8 sm:pt-8 lg:col-start-1 lg:row-start-1 lg:px-10 lg:pb-8 lg:pt-10">
                    {/* 번호는 장식이 아니라 주소다. /event/1/ 의 그 1. 제목보다 한 단 눌러(muted)
                        읽는 순서를 제목 → 번호로 둔다. 번호가 제목과 같은 검정이면 한 글자가
                        제목을 이긴다. */}
                    <span className="sr-only">{t("numberAria", { n: event.id })} </span>
                    <span
                      className="t-metric block tabular-nums text-text-muted"
                      aria-hidden="true"
                    >
                      {event.id}
                    </span>
                    <h2 className="t-h1 mt-4 text-text [overflow-wrap:anywhere] lg:mt-5">
                      {t(`items.${event.key}.title`)}
                    </h2>
                  </div>

                  {/* 미리보기 무대. 카드 안의 글자는 화면 UI 라 스크린리더에서는 통째로 뺀다.
                      링크 이름에 목소리 이름 셋이 끼면 제목이 묻힌다. */}
                  <div
                    aria-hidden="true"
                    className="flex items-center justify-center bg-raised px-5 py-8 sm:px-8 lg:col-start-2 lg:row-start-1 lg:row-end-3 lg:py-10"
                  >
                    <Preview />
                  </div>

                  {/* 손잡이. 버튼처럼 그리지 않는다(카드가 이미 링크다). 글자와 화살표만. */}
                  <div className="flex items-center gap-1.5 px-6 pb-6 pt-6 text-[15px] font-semibold text-text-strong sm:px-8 sm:pb-8 lg:col-start-1 lg:row-start-2 lg:px-10 lg:pb-10 lg:pt-0">
                    <span>{t("open")}</span>
                    <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </div>
                </Link>
              </RevealItem>
            );
          })}
        </RevealGroup>
      </div>
    </section>
  );
}

/**
 * 이벤트 1(내 이름 음성 메시지)의 본질: 좋아하는 인물 카드에서 만들기를 누르면 내 이름을
 * 부르는 메시지가 생긴다. 그래서 본문의 인물 카드(`event-studio.tsx`)를 작게 두 장 겹쳐
 * 놓는다. 구조는 실물과 같다: 이니셜 원 → 이름, 오른쪽에 좋아요, 아래에 만들기 버튼 모양.
 * 본문에 없는 것(기간, 인원, 배지)은 그리지 않는다. 이름은 본문과 같은 `event.celebrities.*`
 * 키, 버튼 글자는 `event.studio.generate` 다.
 *
 * 뒤 카드는 앞 카드 아래로 40px 들어가고 오른쪽으로 12px 밀린다(계단 겹침). 카드 폭을
 * 0.75rem 줄여 두는 이유: 마지막 카드의 밀림까지 더해도 무대 폭 안에 든다. 320px 에서도
 * 넘치지 않는다.
 */
const STEP = ["", "-mt-10 ml-3"] as const;

function VoiceMessagePreview() {
  const t = useTranslations("event");
  return (
    <div className="w-full max-w-[18.5rem]">
      {CELEBRITIES.slice(0, STEP.length).map((c, i) => {
        const name = t(`celebrities.${c.id}.name`);
        return (
          // `relative` 가 없으면 앞 카드의 글자가 뒤 카드의 바닥 위로 그려진다(블록 배경이
          // 먼저, 인라인 글자는 나중에 칠해지는 순서). 위치 지정 요소는 통째로 순서대로 칠해진다.
          // `.card` 를 안 쓰는 이유: 22 라운드를 유틸리티 뒤에서 선언해 `rounded-*` 로 못 덮는다.
          // 실물 카드(22)의 축소판이라 한 단 작은 18 을 쓴다.
          <div
            key={c.id}
            className={`relative w-[calc(100%-0.75rem)] rounded-[var(--radius-lg)] border border-line bg-surface p-4 ${STEP[i]}`}
          >
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-pill)] bg-accent-soft text-[15px] font-bold text-accent">
                {Array.from(name)[0] ?? ""}
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-bold leading-tight text-text">
                {name}
              </span>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-line text-text-muted">
                <Heart className="h-3.5 w-3.5" />
              </span>
            </div>
            {/* 본문의 만들기 버튼과 같은 모양. 눌리지 않는 장식이라 button 이 아니라 span 이다. */}
            <span className="mt-3 flex h-10 items-center justify-center gap-1.5 rounded-[var(--radius-pill)] bg-accent text-[13.5px] font-semibold text-white">
              <Sparkles className="h-3.5 w-3.5" />
              {t("studio.generate")}
            </span>
          </div>
        );
      })}
    </div>
  );
}
