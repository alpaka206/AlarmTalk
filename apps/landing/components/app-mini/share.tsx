import { useTranslations } from "next-intl";
import { GroupCard, GroupHeader, InkPanel, PillButton } from "./primitives";

/**
 * "멀리 있어도, 목소리는 곁에." 의 시각물. 화면 조각 둘을 세로로 세운다(예전 `UiCropStack`
 * 과 같은 배치, gap-5). 위아래 순서가 곧 사용 순서다: 목소리를 나누고 → 누구를 깨울지 고른다.
 *
 * ① 목소리 탭 조각(앱 `VoiceProfileManagementPanel`): 내 목소리 머리에는 이번 달 남은
 *    생성 횟수(`voices_monthly_quota`)와 추가 버튼이 붙고, 공유를 켠 목소리는 부가설명 자리에
 *    '공유 중'(`voicesr_sharing_badge`)이 선다. 공유받은 목소리 행은 누가 줬는지가 부가설명이다.
 *    부품은 `whose-voice.tsx` 와 같은 `GroupHeader`/`GroupCard` 를 그대로 쓴다. 두 섹션이
 *    같은 탭을 그리므로 다르게 그리면 안 된다.
 * ② 누구를 깨울까요 시트(앱 `AlarmTalkApp` 의 `WakerSelectionSheet` + `WakerSheetOptionRow`):
 *    손잡이 → 제목 → 민짜 행 두 개를 끝까지 가는 헤어라인 하나로 나눈다. 시트 안에 카드를
 *    또 두지 않는 건 앱 주석 그대로다(시트가 이미 둥근 컨테이너). 아이콘·체크도 없다. 이 시트는
 *    선택 상태가 없는 액션 시트라 앱도 아무 표시를 안 한다.
 *
 * 시트 판은 `InkPanel` 의 그라데이션 위에 스크림(앱 `WakerScrimColor`, ink 74%)을 깔고 그 위에
 * surface 색 시트를 올린다. 그래야 앱처럼 시트가 배경보다 밝게 뜬다. 스크림 없이 그라데이션
 * 위에 바로 올리면 판 윗부분(ink-high)이 시트(ink-surface)보다 밝아 시트가 꺼져 보인다.
 */

/**
 * 판이 18rem(288px, 뷰포트 328) 보다 좁으면 남은 횟수를 접는다. 그 폭에서는 영어 문구가
 * "1/1 / creations / available" 세 줄이 돼 버튼 옆에 글자 기둥이 선다. 두 줄까지만 허용하고
 * 그 아래는 whose-voice 와 같은 머리([내 목소리 ⌄ … 추가])로 돌아간다. 뷰포트가 아니라
 * 판 폭(@container)을 보는 이유: 이 판은 슬롯 폭에 따라 다르게 놓인다.
 */
const QUOTA_HIDE_WHEN_NARROW = "@max-[18rem]:hidden";

export function ShareMini() {
  const t = useTranslations("appMini.share");

  return (
    <div className="@container flex w-full max-w-[22rem] flex-col gap-5">
      {/* ① 목소리 탭. 폭은 whose-voice 의 탭 열과 같은 22rem(폰 한 대 폭). */}
      <InkPanel label={t("alt.voices")}>
        {/* 머리 제목은 primitives 가 shrink-0 으로 잠가 두었다. 영어 "1/1 creations available"
            이 길면 제목이 아니라 아래 trailing 의 횟수 문구가 두 줄로 접힌다. */}
        <div>
          <GroupHeader
            title={t("myVoices")}
            trailing={
              // 앱 머리의 trailing: [생성 가능 n/1회] 10dp [추가]. 남은 횟수는 버튼보다 먼저 보인다.
              // 좁은 폰에서는 줄바꿈을 허용한다. truncate 는 nowrap 이라 flex 최소폭이 문장
              // 전체가 돼 판을 넘친다. 두 줄이어도 머리 높이(40) 안이다.
              <span className="flex items-center gap-2.5">
                <span
                  className={`min-w-0 text-right text-[12.5px] leading-tight text-ink-body ${QUOTA_HIDE_WHEN_NARROW}`}
                >
                  {t("quota")}
                </span>
                <span className="shrink-0">
                  <PillButton>{t("add")}</PillButton>
                </span>
              </span>
            }
          />
        </div>
        <GroupCard rows={[{ name: t("ownName"), subtitle: t("sharing"), actions: true }]} />

        {/* 묶음 사이 12dp(앱 Column spacedBy). 머리 자체가 min-h-10 이라 더 벌리지 않는다. */}
        <div className="mt-3">
          <GroupHeader title={t("sharedVoices")} />
          <GroupCard rows={[{ name: t("sharedName"), subtitle: t("sharedFrom") }]} />
        </div>
      </InkPanel>

      {/* ② 누구를 깨울까요 시트. 판 안쪽 여백을 음수 마진으로 되돌려 시트가 판 가장자리까지
          닿게 한다. 시트는 화면 아래에서 올라오는 것이라 좌우·아래는 잘려야 맞고, 위에만 잘린
          화면(스크림)이 한 띠 보인다. 판의 라운드로 잘리도록 overflow 를 감춘다. */}
      <InkPanel label={t("alt.target")} className="overflow-hidden">
        <div className="-mx-4 -my-4 bg-ink/75 pt-6 sm:-mx-5 sm:-my-5 sm:pt-7">
          <div className="rounded-t-3xl bg-ink-surface pb-3">
            {/* 손잡이: 36×4 알약, onSurfaceVariant 38%(앱 `WakerSheetDragHandle`). */}
            <span className="mx-auto mb-2.5 mt-3 block h-1 w-9 rounded-[var(--radius-pill)] bg-ink-body/40" />

            {/* 제목은 왼쪽 정렬(앱 titleLarge Bold). 폼 시트와 달리 선택 시트는 가운데가 아니다. */}
            <span className="block px-5 text-[20px] font-bold leading-tight tracking-[-0.01em]">
              {t("sheetTitle")}
            </span>

            {/* 옵션 행: 최소 56, 좌우 20. 헤어라인은 아이콘이 없으니 좌우 끝까지(앱 dividerInset 무관). */}
            <div className="mt-3.5">
              <div className="flex min-h-14 items-center px-5 py-2.5">
                <span className="block min-w-0 flex-1 truncate text-[15px] font-semibold leading-tight">
                  {t("selfTitle")}
                </span>
              </div>
              <span className="block h-px bg-ink-line" />
              <div className="flex min-h-14 items-center px-5 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold leading-tight">
                    {t("targetName")}
                  </span>
                  {/* 받지 않는 시간은 앱처럼 최대 두 줄. 영어 문구는 폰 폭에서 두 줄이 된다.
                      앱 문자열의 %1$s 자리(요일 + 시간대)는 한 덩어리로 둔다. 안 그러면
                      "09:00-" 에서 꺾여 뒷줄이 "18:30" 만 남는다(하이픈은 줄바꿈 지점이다). */}
                  <span className="mt-1 line-clamp-2 text-[12.5px] leading-tight text-ink-body">
                    {t.rich("quietHours", {
                      schedule: (chunks) => <span className="whitespace-nowrap">{chunks}</span>,
                    })}
                  </span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </InkPanel>
    </div>
  );
}
