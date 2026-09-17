/**
 * 이벤트 목록. `/event/` 는 목록이고 `/event/<id>/` 가 각 이벤트다(2026-09-15 지시: 1, 2, 3 …
 * 번호로 쌓인다). 지금은 하나뿐이다. 새 이벤트는 여기에 번호를 하나 더하고, 목록 카피는
 * `messages/*.json` 의 `eventList.items.<key>` 에, 본문은 `app/[locale]/event/[id]/page.tsx`
 * 에서 key 로 갈라 그린다.
 */
export const EVENTS = [{ id: "1", key: "cheer" }] as const;

export type EventEntry = (typeof EVENTS)[number];

export function findEvent(id: string): EventEntry | undefined {
  return EVENTS.find((e) => e.id === id);
}
