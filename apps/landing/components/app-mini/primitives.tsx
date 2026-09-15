import { Fragment, type ReactNode } from "react";
import { ChevronDown, EllipsisVertical, Volume2 } from "lucide-react";

/**
 * 앱 화면 미니어처의 부품. 랜딩은 스크린샷을 자르지 않고 **앱 UI 를 DOM 으로 다시 그린다**
 * (2026-09-15 지시 — 로케일이 붙고, 크기를 자유롭게 하고, 앱 문구가 바뀌어도 낡은 그림이
 * 남지 않는다). 대신 실제 화면과 구조가 같아야 한다: 앱에 없는 요소는 그리지 않는다.
 *
 * 색은 앱 다크 스킴에서 가져온 ink 토큰(`globals.css`)만 쓴다. 판 바닥은 앱 홈/목소리 탭
 * 그라데이션(`HomeGradientDark`)을 ink-high → ink 로 옮긴 것이고, 카드는 `.card-ink`
 * (앱 surface) 그대로다. 글자는 화면 UI 라 스크린리더에는 판 하나가 `role="img"` 한 문장으로
 * 읽힌다(폰 목업과 같은 규칙) — 그래서 판 안에 실제 제목 태그를 두지 않는다.
 */

/** 앱 화면 바닥. Tailwind 가 클래스 문자열을 통째로 찾으므로 조합하지 않고 그대로 쓴다. */
export const INK_SCREEN = "bg-[linear-gradient(180deg,var(--color-ink-high),var(--color-ink))]";

/**
 * 어두운 판 하나 = 앱 화면 한 조각. `UiCrop` 이 하던 일(28 라운드 + ink 링)을 DOM 으로.
 * `label` 이 스크린리더가 듣는 전부다 — 판 안의 글자는 장식이다.
 */
export function InkPanel({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="img"
      aria-label={label}
      className={`w-full rounded-3xl px-4 py-4 text-ink-fg ring-1 ring-ink-line sm:px-5 sm:py-5 ${INK_SCREEN} ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

/** 앱의 채움 알약 버튼(추가 · 저장). 강조색은 앱 다크 primary. */
export function PillButton({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-9 items-center rounded-[var(--radius-pill)] bg-accent-on-dark px-4 text-[13.5px] font-semibold text-accent-fg">
      {children}
    </span>
  );
}

/** 묶음 머리: 제목 + 펼침 화살표(앱 `VoiceCatalogSectionHeader`). 내 목소리만 오른쪽에 추가 버튼. */
export function GroupHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center gap-1">
      <span className="text-[15px] font-semibold leading-tight">{title}</span>
      <ChevronDown className="h-4.5 w-4.5 shrink-0 text-ink-body" strokeWidth={2.2} />
      {trailing ? <span className="ml-auto pl-3">{trailing}</span> : null}
    </div>
  );
}

export type Row = { name: string; subtitle?: string; actions?: boolean };

/**
 * 그룹 카드(앱 `VoiceCatalogGroup`): 목소리마다 카드를 띄우지 않고 한 덩어리 안에서
 * 이름 시작선까지 들여쓴 헤어라인으로만 나눈다.
 */
export function GroupCard({ rows }: { rows: Row[] }) {
  return (
    <div className="card-ink mt-2.5 overflow-hidden">
      {rows.map((row, i) => (
        <Fragment key={row.name}>
          {i > 0 ? <span className="ml-4 block h-px bg-ink-line" /> : null}
          <VoiceRow {...row} />
        </Fragment>
      ))}
    </div>
  );
}

/**
 * 한 행(앱 `VoiceCatalogRow`): 이름과 부가설명, 관리할 게 있는 행(내 목소리)에만 ⋮, 그리고
 * 듣기 스피커. ⋮ 가 없는 행도 데스크톱에서는 같은 폭을 비워 스피커가 세로로 맞는다.
 * 모바일 320px 에서는 그 빈칸을 접어 부가설명이 잘리지 않게 한다.
 */
export function VoiceRow({ name, subtitle, actions }: Row) {
  // 부가설명이 있든 없든 행 높이를 같게(앱 주석). 56px 이면 두 줄 행도 안에 든다.
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-2">
      <div className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-tight">{name}</span>
        {subtitle ? (
          <span className="mt-1 block truncate text-[12.5px] leading-tight text-ink-body">
            {subtitle}
          </span>
        ) : null}
      </div>
      {actions ? (
        <EllipsisVertical className="h-5 w-5 shrink-0 text-ink-body" strokeWidth={2} />
      ) : (
        <span className="hidden h-5 w-5 shrink-0 lg:block" />
      )}
      <Volume2 className="h-5 w-5 shrink-0 text-accent-on-dark" strokeWidth={2} />
    </div>
  );
}
