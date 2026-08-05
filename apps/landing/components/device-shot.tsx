import { useTranslations } from "next-intl";

/**
 * 실제 앱 화면 한 장을 기기 마운트에 얹는다.
 *
 * `next/image` 를 쓰지 않는 이유: 이 사이트는 정적 export(`images.unoptimized`)라
 * 런타임 최적화가 없다. 그 상태의 `next/image` 는 평범한 `<img>` 에 래퍼만 더한 것이라,
 * 두 폭을 미리 뽑아 두고 `srcSet` 으로 넘기는 편이 정직하고 가볍다.
 *
 * `width`/`height` 를 원본 비율로 못박아 CLS 를 0 으로 둔다(`.device` 의 aspect-ratio 와
 * 같은 값). 크기는 CSS 변수 `--w` 하나로만 바뀐다.
 *
 * **알려진 부채**: 스크린샷이 한국어 화면이다. en/ja 에서도 같은 이미지가 뜬다.
 * 지금은 `alt` 만 로케일을 따르고, 로케일별 세트는 후속 과제로 남긴다.
 */

export type ShotName =
  | "home"
  | "register"
  | "message"
  | "fortune"
  | "voices"
  | "share";

type Props = {
  name: ShotName;
  /** 히어로처럼 첫 화면에 들어가는 것만 true — 나머지는 lazy 로 둔다. */
  priority?: boolean;
  className?: string;
  /** 기본 300px. 스트립처럼 여러 장을 늘어놓을 때만 줄인다. */
  width?: number;
};

export function DeviceShot({ name, priority, className, width }: Props) {
  const t = useTranslations("shot");

  return (
    <img
      src={`/screens/${name}.webp`}
      srcSet={`/screens/${name}.webp 1x, /screens/${name}@2x.webp 2x`}
      width={440}
      height={843}
      alt={t(name)}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      {...(priority ? { fetchPriority: "high" as const } : {})}
      className={`device ${className ?? ""}`}
      style={width ? ({ "--w": `${width}px` } as React.CSSProperties) : undefined}
    />
  );
}

/**
 * 화면 두 장을 나란히. 데스크톱은 겹쳐 세우고, 모바일은 **사용자가 밀 때만** 움직이는
 * 가로 스트립이 된다(자동 전환 금지 — 읽는 속도를 우리가 정하지 않는다).
 * 거터를 음수 마진으로 상쇄해 화면 끝까지 흐르게 한다.
 */
export function DeviceShotPair({ names }: { names: [ShotName, ShotName] }) {
  return (
    <div className="-mx-5 flex w-[calc(100%+2.5rem)] snap-x snap-mandatory gap-4 overflow-x-auto px-5 [scrollbar-width:none] md:mx-0 md:w-full md:justify-center md:gap-6 md:overflow-visible md:px-0">
      {names.map((name, i) => (
        <div
          key={name}
          className="shrink-0 snap-center md:shrink"
          /* 가운데 하나만 들어올린다 — 셋 다 다르면 계단처럼 보인다. */
          style={i === 1 ? { transform: "translateY(-24px)" } : undefined}
        >
          <DeviceShot name={name} width={220} />
        </div>
      ))}
    </div>
  );
}
