import { UiCrop, type CropName } from "./ui-crop";

/**
 * 조각 두 개를 겹쳐 세운다. 한 기능에 화면이 둘 필요할 때(목소리를 나누고 → 누구를
 * 깨울지 고르고) 나란히 두면 각각이 작아지므로, 살짝 어긋나게 포개 순서를 만든다.
 *
 * 모바일에서는 겹치지 않는다 — 좁은 폭에서 포개면 아래 것이 거의 안 보인다.
 */
export function UiCropStack({ names }: { names: [CropName, CropName] }) {
  return (
    <div className="w-full">
      <UiCrop name={names[0]} />
      <div className="mt-4 sm:-mt-8 sm:ml-10 sm:w-[85%]">
        <UiCrop name={names[1]} />
      </div>
    </div>
  );
}
