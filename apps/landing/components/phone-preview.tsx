import { AlarmClock, Mic, Menu, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * 히어로 폰. 여기만 스크린샷이 아니라 DOM 으로 그린다 — 두 가지 이유다.
 *  1. LCP 요소라 22KB 이미지보다 DOM 이 빠르다.
 *  2. 로케일이 붙는다. 스크린샷은 한국어 화면 하나뿐이라 en/ja 에서 거짓이 된다.
 *
 * 대신 **실제 홈 화면과 같은 구조**여야 한다. 예전 목업은 앱에 없는 화면("다음 알람"
 * 카드 + 파형 + 바로가기 2칸)을 그리고 있었고, 화면 색도 웜브라운이라 딥네이비인 앱과
 * 달랐다. 실제 홈은 남은 시간 헤드라인 → 알람 한 줄(시각·날짜·목소리·토글) → FAB →
 * 탭 3개다.
 *
 * 파형은 여기서 빼고 소리를 실제로 들려주는 자리에 둔다 — 앱 홈에는 파형이 없다.
 */

// 앱의 딥네이비 화면 값. 페이지 토큰(웜 페이퍼)과 섞이면 안 되는 값이라 이 파일에 둔다.
const SCREEN_TOP = "#182850";
const SCREEN_BOTTOM = "#070b13";
const SCREEN_CARD = "rgba(255,255,255,0.06)";
export const SCREEN_LINE = "rgba(255,255,255,0.10)";
const SCREEN_TEXT = "#f2f5fa";
const SCREEN_MUTED = "#9fb0cc";
export const SCREEN_ACCENT = "#a9cbf5";

type Props = {
  /**
   * 알람 토글 자리에 끼워 넣을 노드. 스크롤에 묶어 켜지는 모습을 보여줄 때 쓴다.
   * 안 주면 켜져 있는 정적 스위치를 그린다.
   */
  toggle?: React.ReactNode;
  /** 기본 min(340px, 78vw). 구간에 따라 더 크게 놓고 싶을 때만 넘긴다. */
  widthClass?: string;
};

export function PhonePreview({ toggle, widthClass }: Props = {}) {
  const t = useTranslations("hero.phone");

  // 폭은 --w 하나로만 바뀐다(.device 가 그걸로 베젤 두께·라운드까지 계산한다).
  // 좁은 화면에서 넘치지 않게 뷰포트에 물린다.
  return (
    <div className={`device mx-auto ${widthClass ?? "[--w:min(340px,78vw)]"}`}>
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-[inherit]"
        style={{
          background: `linear-gradient(180deg, ${SCREEN_TOP} 0%, #0d1730 52%, ${SCREEN_BOTTOM} 100%)`,
        }}
      >
        <div className="flex-1 px-5 pt-7">
          {/* 헤드라인은 언제나 '남은 시간' 이다 — 앱이 그렇게 말한다. */}
          <p
            className="text-[19px] font-bold leading-[1.25] tracking-[-0.01em]"
            style={{ color: SCREEN_TEXT }}
          >
            {t("countdown")}
          </p>

          <div
            className="mt-5 flex items-center justify-between rounded-[18px] px-4 py-4"
            style={{ background: SCREEN_CARD, border: `1px solid ${SCREEN_LINE}` }}
          >
            <div className="min-w-0">
              <p className="whitespace-nowrap leading-none" style={{ color: SCREEN_TEXT }}>
                <span className="text-[15px] font-semibold">{t("meridiem")}</span>
                <span className="ml-1.5 text-[30px] font-bold tracking-[-0.02em]">
                  {t("alarmTime")}
                </span>
              </p>
              <p className="mt-2 truncate text-[11.5px]" style={{ color: SCREEN_MUTED }}>
                {t("alarmMeta")}
              </p>
            </div>
            {/* 앱에서 이 스위치는 저장된 켬/끔에만 묶인다(권한이 모자라다고 꺼진 것처럼
                그리지 않는다). 여기서는 스크롤이 그 자리를 대신할 수 있다. */}
            {toggle ?? (
              <span
                aria-hidden="true"
                className="relative block h-6 w-11 shrink-0 rounded-full"
                style={{ background: SCREEN_ACCENT }}
              >
                <span className="absolute right-0.5 top-0.5 block h-5 w-5 rounded-full bg-white" />
              </span>
            )}
          </div>
        </div>

        {/* FAB — 앱과 같은 자리(오른쪽 아래) */}
        <div className="flex justify-end px-5 pb-4">
          <span
            aria-hidden="true"
            className="grid h-13 w-13 place-items-center rounded-full"
            style={{ background: SCREEN_ACCENT }}
          >
            <Plus className="h-6 w-6" strokeWidth={2.4} style={{ color: "#0d1730" }} />
          </span>
        </div>

        <div
          className="flex items-center justify-around px-5 pb-6 pt-3"
          style={{ borderTop: `1px solid ${SCREEN_LINE}`, background: "rgba(0,0,0,0.28)" }}
        >
          {[
            { icon: AlarmClock, label: t("tabAlarms"), active: true },
            { icon: Mic, label: t("tabVoice"), active: false },
            { icon: Menu, label: t("tabMore"), active: false },
          ].map(({ icon: Icon, label, active }) => (
            <span key={label} className="flex flex-col items-center gap-1">
              <Icon
                className="h-4.5 w-4.5"
                strokeWidth={2}
                style={{ color: active ? SCREEN_ACCENT : SCREEN_MUTED }}
              />
              <span
                className="whitespace-nowrap text-[9.5px] font-semibold"
                style={{ color: active ? SCREEN_ACCENT : SCREEN_MUTED }}
              >
                {label}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
