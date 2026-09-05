type Props = {
  size?: number;
  className?: string;
  /** 옆에 워드마크가 있으면 "" 로 넘긴다 — 이름을 두 번 읽지 않게. */
  alt?: string;
};

/**
 * 공식 앱 아이콘(`public/brand-icon.png`, 256px 정사각·모서리 없음)을 그대로 쓴다.
 *
 * 모서리는 여기서 **한 번만** 깎는다 — 스토어가 아이콘에 씌우는 마스크와 같은 비율(약 22%)
 * 이라, 헤더·푸터 어디에 놓아도 스토어 목록의 아이콘과 같은 모양으로 읽힌다. 호출부에서
 * `rounded-*` 를 덧대지 말 것(두 번 깎이면 비율이 어긋난다). 이 반경은 앱 `Waker*Shape`
 * 토큰이 아니라 아이콘 마스크 비율이다 — 원형 아바타(`CircleShape`)와 같은 예외다.
 */
export function BrandMark({ size = 36, className, alt = "AlarmTalk" }: Props) {
  return (
    <img
      src="/brand-icon.png"
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ display: "block", borderRadius: Math.round(size * 0.22) }}
    />
  );
}
