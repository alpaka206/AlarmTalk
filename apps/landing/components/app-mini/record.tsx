import { ChevronDown, Mic } from "lucide-react";
import { useTranslations } from "next-intl";
import { InkPanel } from "./primitives";

/**
 * 목소리 만들기 화면의 첫 단계(녹음) 조각. "한 번 등록하면 / 알람은 몇 개든" 섹션의 시각물.
 *
 * 스크린샷 크롭(`crops/record.webp`) 대신 DOM 으로 그린다(2026-09-15 지시). 크롭은 낡은
 * 빌드라 마이크가 왼쪽, 시간이 오른쪽이었는데, 앱은 2026-08-16 에 iOS 녹음 카드와 같은
 * 배치(**왼쪽 상태 + 시간, 오른쪽 마이크**)로 바꿨다. 여기서는 그림이 아니라 Compose
 * (`VoiceInputControls.kt` 의 `VoiceRecordControls`)를 따른다.
 *
 * 구조는 앱 `VoiceProfileManagementPanel` 의 Source 단계 그대로다(간격 14dp):
 *  1. `VoiceCaptureModeSelector`: [녹음 | 파일] 반반 알약. 선택된 쪽만 채움.
 *  2. `VoiceRecordControls` 카드: 상태 "녹음하기" + "0:00 / 2:00", 오른쪽 48dp 마이크 원.
 *  3. 안내 두 줄(`voices_record_status_hint` / `voices_record_video_tip`). 앱 주석대로
 *     한 문단으로 붙이지 않고 문장마다 줄을 나눈다.
 *  4. `VoiceRecordScriptCard` 접힌 상태: "예시 대본" + 펼침 화살표. 대사는 예시일 뿐이라
 *     앱도 접어 두므로 여기서도 펼치지 않는다.
 * 녹음 중에만 뜨는 것(펄스 링, 레벨 바)은 대기 화면에 없으니 그리지 않는다.
 *
 * 폭은 26rem 까지. 테스트폰(S23 Ultra · A32)이 412dp 라 그 폭이면 dp 가 px 로 1:1 이 되어
 * 48dp 원, 40dp 알약, 20dp 좌우 여백이 실물 크기로 보인다. 그보다 넓히면 스크린샷을 늘린
 * 것처럼 커진다.
 */

/**
 * 앱 `audioTimeLabel(0)` 과 `audioTimeLabel(VoiceProfileAudioLimits.MAX_DURATION_MILLIS)`.
 * 숫자라 로케일이 없어 메시지 JSON 에 넣지 않는다.
 */
const ELAPSED_LABEL = "0:00";
const MAX_LABEL = "2:00";

export function RecordMini() {
  const t = useTranslations("appMini.record");

  return (
    <InkPanel label={t("alt")} className="mx-auto max-w-[22rem]">
      <div className="space-y-3.5">
        {/* 앱은 두 버튼에 weight(1f) 를 줘 반반이다. 라벨 길이(en "Record"/"File")에
            따라 폭이 달라지면 안 되므로 grid 로 고정한다. */}
        <div className="grid grid-cols-2 gap-2">
          <ModePill selected>{t("modeRecord")}</ModePill>
          <ModePill>{t("modeFile")}</ModePill>
        </div>

        {/* 녹음 카드(WakerCardShape 22 = .card-ink). 시간은 상태 아래 **항상 같은 자리**다(앱 주석). */}
        <div className="card-ink flex items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-semibold leading-tight">
              {t("status")}
            </span>
            <span className="mt-0.5 block truncate text-[12.5px] leading-tight text-ink-body tabular-nums">
              {ELAPSED_LABEL} / {MAX_LABEL}
            </span>
          </div>
          {/* 원 48dp · 글리프 26dp 는 앱 `VoiceRecordCircleButton` 이 정한 유일한 값. */}
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[var(--radius-pill)] bg-accent-on-dark">
            <Mic aria-hidden="true" className="h-6.5 w-6.5 text-accent-fg" strokeWidth={2.2} />
          </span>
        </div>

        {/* 앱 `MutedText`(bodySmall · onSurfaceVariant). 긴 문장은 줄바꿈으로 받는다.
            ja 는 띄어쓰기가 없어 anywhere 가 없으면 한 단어로 칸을 넘친다. */}
        <div className="space-y-1 text-[12.5px] leading-snug text-ink-body">
          <span className="block [overflow-wrap:anywhere]">{t("hint")}</span>
          <span className="block [overflow-wrap:anywhere]">{t("videoTip")}</span>
        </div>

        {/* 예시 대본 카드는 surface 가 아니라 surfaceVariant 반투명이라 녹음 카드보다
            한 단 낮다. .card-ink 를 그대로 쓰면 둘이 같은 카드로 읽혀 ink-raised 로 낮춘다. */}
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-xl)] border border-ink-line bg-ink-raised p-4">
          <span className="truncate text-[14.5px] font-semibold leading-tight">
            {t("scriptTitle")}
          </span>
          <ChevronDown aria-hidden="true" className="h-5 w-5 shrink-0 text-ink-body" strokeWidth={2.2} />
        </div>
      </div>
    </InkPanel>
  );
}

/**
 * 입력 방식 알약(앱 `VoiceInputModeButton`, 높이 40dp). 선택은 채움 Button, 나머지는
 * OutlinedButton 이라 글자가 강조색이고 테두리만 있다. 앱의 채움은 secondary 인데 랜딩에는
 * 그 토큰이 없어 같은 계열의 accent-on-dark 로 그린다.
 */
function ModePill({ selected, children }: { selected?: boolean; children: string }) {
  return (
    <span
      className={`inline-flex h-10 min-w-0 items-center justify-center rounded-[var(--radius-pill)] px-3 text-[14px] font-semibold ${
        selected
          ? "bg-accent-on-dark text-accent-fg"
          : "text-accent-on-dark ring-1 ring-inset ring-ink-body/40"
      }`}
    >
      <span className="truncate">{children}</span>
    </span>
  );
}
