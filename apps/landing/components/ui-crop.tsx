import { useTranslations } from "next-intl";

/**
 * 화면 **조각**. 폰 전체 대신 말하려는 UI 만 잘라 보여준다.
 *
 * 폰을 통째로 놓으면 정작 가리키려는 부분이 화면의 1/5 로 줄고 나머지는 빈 배경이다.
 * 조각으로 자르면 문장과 그림이 같은 것을 가리킨다.
 *
 * 어두운 UI 라 흰 바닥 위에서는 가장자리가 필요하다 — 베젤 대신 얇은 링과 라운드로
 * "잘라 온 조각" 임을 드러낸다(폰 흉내를 내면 잘린 게 실수처럼 보인다).
 */

export type CropName =
  | "alarm-row"
  | "record"
  | "pick-message"
  | "voice-groups"
  | "who-to-wake";

/** 원본 비율. 1x 파일은 폭 560px 이라 높이는 여기서 계산한다(CLS 방지용 width/height). */
const RATIO: Record<CropName, [number, number]> = {
  "alarm-row": [1340, 605],
  record: [1340, 720],
  "pick-message": [1340, 1220],
  "voice-groups": [1340, 915],
  "who-to-wake": [1440, 780],
};
const BASE_WIDTH = 560;

export function UiCrop({
  name,
  priority,
  className,
}: {
  name: CropName;
  priority?: boolean;
  className?: string;
}) {
  const t = useTranslations("crop");
  const [w, h] = RATIO[name];

  return (
    <img
      width={BASE_WIDTH}
      height={Math.round((BASE_WIDTH * h) / w)}
      fetchPriority={priority ? "high" : undefined}
      src={`/crops/${name}.webp`}
      srcSet={`/crops/${name}.webp 1x, /crops/${name}@2x.webp 2x`}
      alt={t(name)}
      loading={priority ? "eager" : "lazy"}
      decoding={priority ? "sync" : "async"}
      style={{ aspectRatio: `${w} / ${h}` }}
      className={`h-auto w-full rounded-3xl ring-1 ring-ink-line ${className ?? ""}`}
    />
  );
}
