# Agent Instructions

AlarmTalk은 OS 네이티브 **목소리 알람 앱**이다. 네이티브 리라이트는 완료되었고, 이 리포의 체크아웃된 코드가 단일 진실이다.

> ⚠ **이 문서는 포인터다. 규약 본문은 [`CLAUDE.md`](CLAUDE.md) 에 있다.**
>
> 예전에는 이 문서가 CLAUDE.md 의 규칙들을 요약해 다시 적었다(52줄 중 약 35줄). 그러다
> 한쪽만 고쳐져 **정면으로 모순**이 났다 — 2026-08-11 시점에 이 문서는 "iOS 앱은 없다" 고
> 적고 있었는데 CLAUDE.md 는 "2026-08-06 되살렸다" 였다. 같은 규칙을 두 곳에 두면 반드시
> 갈라지므로, **여기는 링크만 두고 내용은 한 곳에서만** 관리한다.
>
> 규칙을 추가하고 싶으면 CLAUDE.md 나 `docs/spec/` 에 쓰고, 여기에는 옮겨 적지 않는다.

## 작업 전 필독

- ⭐ **[`docs/spec/`](docs/spec/README.md)** — **동작 스펙. 안드로이드·iOS·백엔드 공통 단일 출처.**
  화면 동작·규칙을 건드리기 전에 **여기부터 읽는다.** 구현이 스펙과 다르면 **구현이 틀린 것**이고,
  동작을 바꾸려면 **스펙을 먼저 고친다.** 각 문서 끝의 「구현 지도」 표가 규칙 한 줄이 세 구현의
  어디에 사는지 알려 준다 — **한 곳만 고치는 사고**를 막는 장치다.
- [`CLAUDE.md`](CLAUDE.md) — 빌드·배포·보안 규약, 디자인 토큰, UI·입력 규약 **전문**
- [`docs/README.md`](docs/README.md) — 문서 인덱스 (코딩·git 컨벤션은 `docs/standards/README.md`)
- [`docs/qa/dev-test-handoff.md`](docs/qa/dev-test-handoff.md) — 진행 중 작업·테스트 체크리스트 (세션 재개 시 먼저)

## 모노레포 구조

- `packages/backend` — Cloudflare Workers + Hono + Turso(libSQL)
- `packages/shared` — zod 스키마. 백엔드·클라이언트 공용 계약
- `packages/voice` — 보이스 프로바이더 어댑터 계층(백엔드에서 사용)
- `apps/android-native` — Kotlin/Compose. dev/prod flavor
- `apps/ios-native` — SwiftUI. **2026-08-06 되살렸다**(브랜치 `feat/ios-revive`, 아직 미출시)
- `apps/landing` — 웹 랜딩

## 알람 불변 규칙

여기만 이 문서의 고유 내용이다 — 다른 곳에 전문이 없다.

- AlarmTalk은 진짜 알람 앱이다. 알림/리마인더 앱이 아니다.
- **알람 발사(울림) 정확성은 전부 로컬**: `AlarmManager` + 로컬 DB 상태 + 로컬 오디오 파일 +
  로컬 게이트(예: 울림 시점 유료권한 확인). 울림이 '제대로 울리는지'는 푸시·서버 cron·실시간
  네트워크에 **의존하지 않는다** — 이 불변식은 유지한다.
- **FCM data-only 푸시는 상태 동기화 용도**다(발사 경로가 아니라, 서버의 상태 변화를 클라에
  즉시 반영). 대상: ① 공유 플랜에서 상대가 내 알람을 설정, ② 목소리 공유 on/off,
  ③ 플랜 변경(구독 만료·취소·**스토어 전환**), ④ 플랜 변경으로 알람이 강등돼야 할 때,
  ⑤ 멤버 내보내기.
  구현: `lib/billing-cancel.ts` 의 `notifyPlanChanged` → `lib/fcm.ts` → 안드로이드
  `fcm/AlarmTalkMessagingService.kt`. 결제 흐름에서의 위치는
  [`docs/spec/billing-lifecycle.md`](docs/spec/billing-lifecycle.md) 「구현 지도」 참조.
- 단 **FCM 은 '즉시성'을 위한 것일 뿐 유일 경로가 아니다** — 오프라인·미배달로 놓쳐도 로컬
  폴백(앱 시작 시 재조회 + 울림 시점 게이트)이 정확성을 보장해야 한다. 상태 변경은 반드시
  서버 응답으로 재확인 후 적용한다(푸시만 믿고 바꾸지 않는다).
- 알람 엔진 변경은 **실기기에서 검증한다.** 로그인·소셜·빌링 확장이 검증된 알람 엔진을
  약화시키면 안 된다.

## Git 규약 (이 문서 고유분만)

전문은 [`CLAUDE.md`](CLAUDE.md) 「컨벤션」 — 커밋 메시지 한국어, `ci` 라벨, 보호 브랜치 등.

- 스쿼시로 구현 히스토리를 뭉개지 말 것(명시 요청 시에만).
- env 파일, 네이티브 빌드 산출물, 로그, 기기 덤프, 로컬 녹음, 테스트 아티팩트는 git에 넣지 않는다.
