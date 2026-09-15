import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { InkPanel } from "./primitives";

/**
 * "문구는 골라도 되고, 직접 써도 돼요." 의 시각물. 앱 편집기의 **문구 화면**
 * (`AlarmRandomPromptSettings.kt`) 을 DOM 으로 그린 것. `UiCrop name="pick-message"` 가
 * 보여주던 낡은 크롭(항목 이름이 '사랑' 이던 빌드)을 대신한다.
 *
 * 실제 화면과 구조가 같다: 상단바(원형 뒤로가기 + 가운데 제목 '문구', `WakerTopBar`) →
 * 라디오 목록 카드(`SnoozeOptionSection` + `SnoozeRadioRow`, 항목은 `EditorMessageContexts`
 * 순서 그대로: 기본 인사말 · 날씨 · 운세 · 응원 · 약 · 직접 입력) → 직접 입력을 고른 상태에서만
 * 나타나는 '직접 입력 문구' 카드(`RandomPromptDetailRow`, 값 + '변경하기').
 *
 * 골라져 있는 항목이 **직접 입력**인 이유: 섹션 카피의 뒷절("직접 써도 돼요")이 이 그림의
 * 요점이고, 그 아래 카드에 실제로 쓴 문장이 보여야 "골라도 되고" 와 "직접 써도 돼요" 가 한
 * 화면에 같이 선다. 목록만 그리면 앞절만 보인다.
 *
 * 크롭의 "(99/100)" 은 글자 수가 아니라 **이번 달 남은/총 직접 입력 횟수**다. 앱이 유료
 * 플랜(한도 personal 30 · couple 50 · family 100)에서 `"$label ($remaining/$limit)"` 로
 * 라벨 뒤에 붙인다. 형식이 세 언어 공통이라 숫자는 여기 두고 라벨만 로케일에서 읽는다.
 * 목소리 탭 미니어처의 가족(엄마·아빠·할머니)과 같은 집이므로 가족 이용권(100)이다.
 *
 * 앱에 없는 것은 그리지 않는다. 라디오는 앱 `CompactSelectionDot`(18dp, 고른 것만 채움 +
 * 안쪽 점), 구분선은 앱처럼 텍스트 시작선(14+18+12=44)까지 들여쓴다.
 */

/** 앱 `EditorMessageContexts` 의 노출 순서. 마지막이 직접 입력이라 목록 끝이 곧 이 그림의 요점이다. */
const OPTIONS = ["preset", "weather", "fortune", "cheer", "medication", "manual"] as const;
const SELECTED: (typeof OPTIONS)[number] = "manual";

export function PickMessageMini() {
  const t = useTranslations("appMini.pick-message");

  return (
    <InkPanel label={t("alt")} className="mx-auto max-w-[22rem]">
      {/* 상단바(뒤로가기 + 제목)는 그리지 않는다. 다른 조각(녹음·목소리 탭)이 다 크롬 없는
          '조각' 문법이라 여기만 화면 전체로 읽히면 안 된다. */}
      {/* 라디오 목록 카드(앱 `SnoozeOptionSection`, `WakerPanelShape` 18). `.card-ink` 를 안 쓰는
          이유: 그 클래스는 22 라운드를 유틸리티보다 뒤에서 선언해 `rounded-*` 로 못 덮는다. */}
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-ink-line bg-ink-surface">
        {OPTIONS.map((option, i) => (
          <Fragment key={option}>
            {i > 0 ? <span className="ml-11 block h-px bg-ink-line" /> : null}
            <RadioRow label={t(`options.${option}`)} selected={option === SELECTED} />
          </Fragment>
        ))}
      </div>

      {/* 직접 입력 문구 카드(앱 `RandomPromptDetailRow`): 제목은 작은 보조 글씨, 값이 본문.
          앱은 여기서 문구를 자르지 않는다(전문을 확인하는 유일한 자리)라 줄바꿈으로 둔다. */}
      <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-lg)] border border-ink-line bg-ink-surface py-3 pl-3.5 pr-1.5">
        <div className="min-w-0 flex-1">
          <span className="block text-[12px] leading-tight text-ink-body">{t("manualTitle")}</span>
          <span className="mt-1 block text-[15px] leading-snug [overflow-wrap:anywhere]">
            {t("manualText")}
          </span>
        </div>
        <span className="shrink-0 px-3 py-2 text-[13.5px] font-semibold text-accent-on-dark">
          {t("change")}
        </span>
      </div>
    </InkPanel>
  );
}

/**
 * 한 행(앱 `SnoozeRadioRow`): 선택 점 + 라벨. 라벨은 앱처럼 regular 다. 굵게 두면 목록이 전부
 * 강조돼 고른 항목이 안 도드라진다(체크로만 구분한다). 앱이 직접 입력 옆에 붙이는 이번 달
 * 횟수 "(94/100)" 는 방문자에게 설명 없는 숫자라 그리지 않는다.
 */
function RadioRow({ label, selected }: { label: string; selected: boolean }) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-3.5 py-2">
      <span
        className={`grid h-4.5 w-4.5 shrink-0 place-items-center rounded-[var(--radius-pill)] border-[1.5px] ${
          selected ? "border-accent-on-dark bg-accent-on-dark" : "border-ink-body/70"
        }`}
      >
        {selected ? <span className="block h-1.5 w-1.5 rounded-[var(--radius-pill)] bg-accent-fg" /> : null}
      </span>
      <span className="min-w-0 truncate text-[15px] leading-tight">{label}</span>
    </div>
  );
}
