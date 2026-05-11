# 경험치(XP) 규칙

Phase 7 게이미피케이션에서 캐릭터가 획득하는 XP·애정도 규칙을 정의한다. 이 문서가 **단일 사실 소스(SSOT)** 이며, 실제 로직은 `packages/backend/src/lib/xpRules.ts` 에 이 문서와 동일한 수치로 구현한다.

## 배경

- Phase 7 #40 (#91) 에서 `characters` 테이블과 XP→레벨 임계 공식(`100 * (n-1)^2`)을 도입.
- #42 XP 지급 API 를 만들기 전에 "어떤 행동이 몇 XP 를 주는가" 를 한곳에서 결정해야 향후 밸런싱이 쉬움.
- 목표: **MVP 수준에서 일관된 피드백 루프** — 알람을 끝까지 듣는 긍정 행동을 장려, 강제 종료·스팸성 지급은 차단.

## 이벤트 → XP / 애정도 매핑

| 이벤트 (`XpEvent`)        | XP | 애정도 | 의미                                        |
| ------------------------- | -- | ------ | ------------------------------------------- |
| `alarm_completed`         | 10 | 2      | 알람을 끝까지 듣고 정상 종료                |
| `alarm_snoozed`           | 5  | 0      | 스누즈 버튼 — 소량만 지급, 애정도는 없음    |
| `alarm_dismissed`         | 0  | 0      | 강제 종료 / 재생 없이 무시                  |
| `family_alarm_received`   | 10 | 3      | 가족이 보낸 알람을 성공적으로 수신·재생     |
| `friend_invited`          | 50 | 5      | 친구 초대가 수락됨 (성장 초반 부스터)       |

### 설계 근거

- **10 vs 5 vs 0**: 정상 완료(10)는 스누즈(5)의 2배. 매일 알람을 끄는 핵심 행동을 보상하되, 스누즈를 계속 눌러 XP 파밍하는 유인을 막고, 강제 종료는 보상 없음.
- **가족 알람 10·3**: 개인 알람(30/2)보다 적지만 **애정도는 더 크다**. 게이미피케이션이 관계 기반 앱 본질과 맞닿도록 — 가족 간 교류가 잦을수록 감정 척도(affection)가 빨리 올라감.
- **친구 초대 50·5**: 1회성 부스터. 네트워크 효과를 초기에 유도.

## 일일 XP 캡

- `DAILY_XP_CAP = 200 XP`
- 오늘 이미 획득한 XP(=`alreadyEarnedToday`) 기준. 자정(사용자 로컬) 기준 리셋은 #42 API 구현 시 DB 쪽에서 관리.
- **정확한 반감 규칙**: 지급 요청 XP 가 남은 캡을 넘으면 **남은 몫만 지급**하고 `capped=true` 플래그를 리턴. 예시:
  - `already=195, earned=10` → `grantedXp=5, capped=true`
  - `already=200, earned=10` → `grantedXp=0, capped=true`
  - `already=0, earned=10` → `grantedXp=10, capped=false`

### 왜 **애정도는 캡이 없는가**

- XP 캡은 "레벨 인플레이션 방지" 목적이라 의도적으로 엄격.
- 애정도는 **관계 상태 표현** 척도 — 가족/친구와 교류하는 날은 그 크기만큼 반영돼야 직관적. (ex. 가족 알람을 하루 10번 받으면 XP 는 캡에 막혀도 애정도는 30 증가)
- 악용 가능성은 이벤트 발행 조건(수신자 측 재생 성공 등) 에서 방어.

## 순수 함수 계약

`packages/backend/src/lib/xpRules.ts` 에서 제공:

```ts
type XpEvent =
  | 'alarm_completed'
  | 'alarm_snoozed'
  | 'alarm_dismissed'
  | 'family_alarm_received'
  | 'friend_invited';

const DAILY_XP_CAP = 200;

function computeXpForEvent(event: XpEvent): number;
function computeAffectionForEvent(event: XpEvent): number;
function isXpEvent(value: unknown): value is XpEvent;

interface DailyCapResult {
  grantedXp: number;
  capped: boolean;
  remainingCap: number;
}
function applyDailyXpCap(
  earned: number,
  alreadyEarnedToday: number,
  cap?: number,
): DailyCapResult;

interface GrantResult {
  xp: DailyCapResult;
  affection: number;
  event: XpEvent;
}
function computeGrant(
  event: XpEvent,
  alreadyEarnedToday: number,
  cap?: number,
): GrantResult;
```

## 엣지 케이스·방어

- `earned` 가 0 이하이거나 `NaN` → `grantedXp=0, capped=false`. 캡을 건드리지 않는다.
- `alreadyEarnedToday` 가 음수 → 0 으로 간주.
- `cap` 이 비유한이면 0 으로 처리 → 모든 지급이 차단됨. (0 은 테스트 시나리오용)
- `computeXpForEvent` 는 화이트리스트 외 값은 TS 컴파일 단에서 차단. 런타임 입력은 `isXpEvent` 가드로 방어.

## 다음 단계 (#42 범위)

1. `POST /api/characters/xp { event, occurred_at?, client_nonce? }` 라우트 신설.
2. 서버가 `alreadyEarnedToday` 를 DB 에서 조회(`characters.daily_xp` 또는 별도 `character_xp_logs` 테이블) → `computeGrant` 호출 → 트랜잭션으로 `xp += grantedXp, affection += affection` 업데이트.
3. `characters.level`·`stage` 는 응답 시 `computeLevelFromXp`/`computeStageFromLevel` 로 재계산 + DB 에도 동기화.
4. 중복 지급 방지 — `(user_id, client_nonce)` 유니크 인덱스로 idempotent.

## 향후 조정 여지 (Phase 10)

- 요일 보너스 / 주간 미션 / 연속 일 수 보너스.
- `alarm_snoozed` 를 0 으로 강등할지 모니터링 (스누즈 남용 시).
- `family_alarm_received` 를 `family_alarm_opened` vs `...replayed` 로 세분화.
- 국가별 아침 시간대 보정 (04~07시 정상 완료 시 +α 등).
