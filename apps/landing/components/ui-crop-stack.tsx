import { UiCrop, type CropName } from "./ui-crop";

/**
 * 한 기능에 화면이 둘 필요할 때(목소리를 나누고 → 누구를 깨울지 고르고) 쓰는 배치.
 *
 * 처음에는 살짝 어긋나게 포갰는데, 겹친 부분이 "의도한 레이어" 가 아니라 "잘못 놓인
 * 이미지" 로 읽혔다. 조각은 이미 잘린 그림이라 그 위에 또 잘림을 얹으면 무엇이
 * 의도인지 알 수 없다. 그냥 위아래로 떼어 놓는다 — 둘 다 온전히 보이고, 세로 순서가
 * 곧 사용 순서가 된다.
 */
export function UiCropStack({ names }: { names: [CropName, CropName] }) {
  return (
    <div className="flex w-full flex-col gap-5">
      {names.map((name) => (
        <UiCrop key={name} name={name} />
      ))}
    </div>
  );
}
