import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Reveal } from "../motion/reveal";
import { GroupCard, GroupHeader, INK_SCREEN, PillButton } from "../app-mini/primitives";

/**
 * 챕터 1. 어떤 목소리로 일어날 수 있는가. (2026-09-15 시안 3개 중 오너 선택: 앱 목소리 탭 실물)
 *
 * 답은 앱 목소리 탭에 이미 그려져 있다. 그 탭은 세 묶음(내 목소리 / 공유받은 목소리 /
 * 기본 목소리)이고, 이 섹션의 세 항목이 정확히 그 세 묶음이다. 그래서 세 항목을 균일한
 * 3열 텍스트로 나열하는 대신(그게 "심심하다"는 지적을 받았다) **목소리 탭 하나를 가운데
 * 펼쳐 놓고**, 각 묶음 옆에 그 묶음의 설명을 단다. 항목마다 그림을 하나씩 따로 짓지
 * 않는 이유: 세 그림이면 다시 3열 격자가 된다. 탭 하나면 세 출처가 "같은 목록의 세 칸"
 * 이라는 사실까지 같이 보인다.
 *
 * 폰 목업(`phone-preview.tsx`)처럼 스크린샷이 아니라 DOM 으로 그린다. 로케일이 붙어야
 * 하고(스크린샷은 한국어뿐), 묶음마다 크기가 달라야 하기 때문이다(1행 / 2행 / 4행).
 * 대신 **실제 화면과 구조가 같다**: 묶음 머리(제목 + 펼침 화살표, 내 목소리에는 추가
 * 버튼) → 그룹 카드 → 행(이름, 부가설명, 내 목소리에만 ⋮, 듣기 스피커). 앱의
 * `VoiceProfileManagementPanel` / `VoiceCatalogRow` 그대로이고, 앱에 없는 것(아바타,
 * 별점, 숫자)은 그리지 않는다. 기본 목소리 넷의 이름은 히어로 미리듣기와 같은 키를 쓴다.
 *
 * 데스크톱: [설명 | 탭 | 설명] 3열. 탭은 가운데 22rem(폰 폭), 설명은 묶음의 오른쪽 →
 * 왼쪽 → 오른쪽으로 번갈아 붙는다. 어두운 바닥은 `ul::before` 하나가 세 행을 관통해서
 * 그린다. 행마다 따로 칠하면 이음새가 생기고, 리빌이 행을 움직일 때 틈이 벌어진다.
 * 모바일: 묶음마다 자기 바닥을 갖고 설명 아래에 선다.
 *
 * 색은 앱 다크 스킴에서 가져온 ink 토큰(`globals.css`)만 쓴다. 탭 바닥은 앱 홈/목소리
 * 탭 그라데이션을 ink-high → ink 로 옮긴 것이고, 카드는 `.card-ink`(앱 surface) 그대로다.
 */

/** 가운데 열 22rem 은 폰 한 대 폭. 양옆은 남는 폭을 똑같이 나눈다. ul 과 li 가 같은 값을 쓴다. */
const SCENE_COLUMNS = "lg:grid-cols-[minmax(0,1fr)_22rem_minmax(0,1fr)]";
/** Tailwind 는 소스에서 클래스 문자열을 통째로 찾으므로 `lg:before:` 판을 조합하지 않고 따로 적는다. */
const TAB_BACKGROUND_BEFORE =
  "lg:before:bg-[linear-gradient(180deg,var(--color-ink-high),var(--color-ink))]";
/** 행 번호도 같은 이유로 조합하지 않는다. */
const ROW_START = ["lg:row-start-1", "lg:row-start-2", "lg:row-start-3"] as const;
const GROUP_KEYS = ["own", "shared", "system"] as const;
/**
 * 하나의 탭이므로 첫 묶음 위와 마지막 묶음 아래만 넉넉하고, 묶음 사이는 앱처럼 촘촘하다.
 * 설명 글이 묶음보다 길어 행이 늘어나면 첫 묶음은 위, 마지막 묶음은 아래 가장자리에 붙는다.
 * 그래야 남는 공간이 탭의 바깥 여백이 아니라 묶음 사이로 들어가 목록 간격처럼 읽힌다.
 */
const GROUP_CELL = [
  "lg:self-start lg:pt-7 lg:pb-3",
  "lg:self-center lg:py-3",
  "lg:self-end lg:pt-3 lg:pb-7",
] as const;

export function WhoseVoice() {
  const t = useTranslations("whoseVoice");
  const tVoices = useTranslations("voicePreview");
  const items = [0, 1, 2] as const;

  // 탭의 세 묶음. 순서는 앱과 같다(개인화된 목소리가 먼저, 기본 목소리가 맨 아래).
  const groups: Record<(typeof items)[number], ReactNode> = {
    0: (
      <>
        <GroupHeader
          title={t("mini.myVoices")}
          trailing={<PillButton>{t("mini.add")}</PillButton>}
        />
        <GroupCard rows={[{ name: t("mini.ownName"), actions: true }]} />
      </>
    ),
    1: (
      <>
        <GroupHeader title={t("mini.sharedVoices")} />
        <GroupCard
          rows={[
            { name: t("mini.shared.0.name"), subtitle: t("mini.shared.0.from") },
            { name: t("mini.shared.1.name"), subtitle: t("mini.shared.1.from") },
          ]}
        />
      </>
    ),
    2: (
      <>
        <GroupHeader title={t("mini.systemVoices")} />
        {/* 기본 목소리에는 부가설명이 없다. 묶음 이름이 이미 '기본 목소리' 라고 말한다(앱 주석). */}
        <GroupCard
          rows={(["siwoo", "mina", "dohyun", "aeni"] as const).map((voice) => ({
            name: tVoices(`voices.${voice}`),
          }))}
        />
      </>
    ),
  };

  return (
    <section id="voices" className="relative">
      <div className="section-pad mx-auto max-w-6xl px-5 md:px-8">
        <Reveal className="mx-auto max-w-155 text-center">
          <h2 className="t-h1 text-text">{t("headline")}</h2>
        </Reveal>

        {/* 세 행이 하나의 탭 화면을 이룬다. 데스크톱에서는 ::before 가 2열(탭 자리)을
            1~3행에 걸쳐 칠하고, 각 li 는 같은 3열 템플릿으로 그 위에 놓인다. 템플릿이 같으면
            서브그리드 없이도 열이 맞는다(가운데 열이 고정 폭이라 양옆이 똑같이 나뉜다).
            li 는 명시 배치(row-start)다. 자동 배치면 ::before 가 차지한 칸을 피해 4행으로 밀린다. */}
        <ul
          className={[
            "mx-auto mt-14 flex max-w-5xl flex-col gap-y-14 lg:mt-16 lg:grid lg:gap-x-10 lg:gap-y-0",
            SCENE_COLUMNS,
            "lg:before:col-start-2 lg:before:row-start-1 lg:before:row-end-4",
            "lg:before:rounded-3xl lg:before:ring-1 lg:before:ring-ink-line",
            TAB_BACKGROUND_BEFORE,
          ].join(" ")}
        >
          {items.map((i) => {
            // 설명은 탭의 오른쪽 → 왼쪽 → 오른쪽. 왼쪽에 붙는 설명은 탭을 향해 오른끝 정렬.
            const textOnLeft = i === 1;
            return (
              <Reveal
                as="li"
                key={i}
                className={`lg:col-span-full lg:grid lg:items-center lg:gap-x-10 ${SCENE_COLUMNS} ${ROW_START[i]}`}
              >
                <div
                  className={`max-w-[36rem] lg:row-start-1 lg:max-w-none ${
                    textOnLeft ? "lg:col-start-1 lg:text-right" : "lg:col-start-3"
                  }`}
                >
                  <h3 className="t-h2 text-text [overflow-wrap:anywhere]">{t(`items.${i}.title`)}</h3>
                  <p className="t-body mt-3 text-text-body [overflow-wrap:anywhere]">
                    {t(`items.${i}.body`)}
                  </p>
                </div>

                {/* 탭의 한 묶음. 모바일에서는 자기 바닥(그라데이션 + 링 + 28 라운드)을 갖고,
                    데스크톱에서는 바닥을 벗고 ul::before 위에 앉는다. 안의 글자는 화면 UI 라
                    role="img" 로 묶어 한 문장으로 읽힌다(폰 목업과 같은 규칙). */}
                <div
                  role="img"
                  aria-label={t(`mini.alt.${GROUP_KEYS[i]}`)}
                  className={[
                    "mt-5 w-full max-w-[22rem] rounded-3xl px-4 py-4 text-ink-fg ring-1 ring-ink-line sm:px-5 sm:py-5",
                    INK_SCREEN,
                    "lg:col-start-2 lg:row-start-1 lg:mt-0 lg:max-w-none lg:rounded-none lg:bg-none lg:px-6 lg:ring-0",
                    GROUP_CELL[i],
                  ].join(" ")}
                >
                  {groups[i]}
                </div>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
