import { existsSync } from "node:fs";
import path from "node:path";
import type { ComponentType } from "react";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { EVENTS, type EventEntry } from "@/lib/events";
import { CELEBRITIES } from "@/components/event/event-catalog";
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
        {/* 페이지 제목은 헤더의 강조된 '이벤트' 가 대신한다(2026-09-15 지시). 문서 개요를 위해
            h1 은 두되 보이지 않게. */}
        <h1 className="sr-only">{t("headline")}</h1>

        {/* 첫 포스터가 곧 첫 화면이라 관찰자에 걸지 않고 mount 로 띄운다. */}
        <RevealGroup
          as="ol"
          className="flex flex-col gap-6"
          stagger={0.09}
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
 * 이벤트 1(내 이름 음성 메시지)의 본질: 좋아하는 인물이 **내 이름을 불러 준다**. 그래서
 * 카드 축소판을 겹쳐 놓는 대신(버튼이 서로 가려 어수선했다) 말풍선 하나와 인물 둘만 둔다:
 * 위에 이름이 들어간 메시지 한 줄, 아래에 인물 초상 둘과 이름. 사진이 오면 초상 원이 사진이
 * 된다(`public/event/<id>.jpg`, 없으면 이니셜). 본문에 없는 것(기간, 인원, 배지)은 그리지
 * 않는다. 문장은 본문과 같은 `event.studio.kinds.birthday.line`, 이름은 `event.celebrities.*`.
 */
function VoiceMessagePreview() {
  const t = useTranslations("event");
  const sample = t("studio.namePlaceholder").replace(/^.*?:\s*/, "").replace(/…$/, "");
  return (
    <div className="flex w-full max-w-[18.5rem] flex-col items-center">
      {/* 말풍선. 꼬리는 아래 인물 쪽을 향한다. */}
      <div className="relative w-full rounded-[var(--radius-xl)] border border-line bg-surface px-5 py-4 text-center text-[15px] font-semibold leading-snug text-text">
        {t.rich("studio.kinds.birthday.line", {
          name: sample,
          b: (chunks) => <span className="text-accent">{chunks}</span>,
        })}
        <span
          className="absolute left-1/2 top-full -ml-2 h-4 w-4 -translate-y-1/2 rotate-45 border-b border-r border-line bg-surface"
        />
      </div>

      <div className="mt-7 flex items-start justify-center gap-8">
        {CELEBRITIES.map((c) => {
          const name = t(`celebrities.${c.id}.name`);
          return (
            <div key={c.id} className="flex w-20 flex-col items-center">
              <PreviewPortrait src={c.portrait} name={name} />
              <span className="mt-2.5 truncate text-[14px] font-bold text-text">{name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 초상 원. 사진 파일이 `public/` 에 있으면 사진, 없으면 이니셜. 서버 컴포넌트라(정적 export 는
 * 빌드 때 렌더) 파일 존재를 직접 본다 — 없는 사진에 깨진 이미지 아이콘을 띄우지 않는다.
 */
function PreviewPortrait({ src, name }: { src: string; name: string }) {
  const hasPhoto = existsSync(path.join(process.cwd(), "public", src));
  return (
    <span className="relative grid h-20 w-20 place-items-center overflow-hidden rounded-[var(--radius-pill)] bg-accent-soft text-[24px] font-bold text-accent ring-1 ring-line">
      {hasPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span>{Array.from(name)[0] ?? ""}</span>
      )}
    </span>
  );
}
