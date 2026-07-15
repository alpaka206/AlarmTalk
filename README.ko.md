# 알람톡

> [English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md)

**알람톡**은 OS-네이티브 음성 알람 앱입니다. 정해둔 시간에 사용자가 고른 목소리 — 직접 녹음한 음성, 가족·연인이 공유한 음성, 또는 AI로 클론한 음성 — 으로 실제 알람을 울립니다.

## 왜 "진짜" 알람인가

대부분의 음성 알람 앱은 푸시 알림이나 서버 cron에 의존하기 때문에 비행기 모드, Doze, 약한 네트워크에서 알람이 조용히 실패할 수 있습니다. 알람톡은 OS-네이티브 알람 스케줄러로 울리고 로컬에 캐시된 오디오만 재생하므로 울림 경로는 네트워크가 필요 없습니다.

## 현재 상태

- **버전**: `v0.1.2` (Closed Beta 준비)
- **Android** — 주력 플랫폼, 코어 알람 엔진은 실기기 검증 완료:
  - 무료: 시스템 목소리 + 사전 렌더된 알람 프리셋 클립, 해제할 때마다 로컬 순차 회전(버킷 회전)
  - 유료: AI 클론 목소리 프리셋을 "유지" 확정 후 서버에서 사전 렌더, 울림 시점엔 완전 오프라인 재생 — 오프라인(비행기 모드) 울림은 실기기 QA 대기
  - 가족 알람은 FCM 데이터 푸시로 멤버에게 즉시 전달(울림 자체는 로컬 — 규칙 #1) — 백그라운드 전달은 실기기 QA 대기
  - Google Play 결제: 코드 완성, Play Console 설정 대기
- **iOS**: 보류 — 미운영, CI 빌드 비활성(수동 `workflow_dispatch` 만)
- **Backend**: Cloudflare Workers + Hono + Turso — CI 자동 배포 + DB 마이그레이션(`develop` → dev, `main` → prod)

## 기술 스택

| 영역 | 스택 |
|---|---|
| Android | Kotlin 2.0 · Jetpack Compose · Material 3 · Room · DataStore · Retrofit · WorkManager · `AlarmManager.setAlarmClock` |
| iOS (보류) | Swift · SwiftUI · AlarmKit · ActivityKit (Live Activity) |
| Backend | TypeScript 6 · Hono 4 · Cloudflare Workers · Zod · Vitest |
| Database | Turso (libSQL / SQLite) |
| Storage | Cloudflare R2 (결정적 TTS 캐시) |
| Voice AI | ElevenLabs — Instant Voice Clone + TTS |
| Auth | JWT (HS256, 7일) · Google ID 토큰 · Apple ID 토큰 |
| Landing | Next.js (App Router) + next-intl + Tailwind v4 (`apps/landing`) |

## 저장소 구조

```
.
├── apps/
│   ├── android-native/   Kotlin + Jetpack Compose Android 앱
│   ├── ios-native/       SwiftUI + AlarmKit PoC
│   └── landing/          정적 랜딩 페이지
├── packages/
│   ├── backend/          Cloudflare Workers + Hono API
│   ├── shared/           공용 타입 · Zod 스키마
│   ├── ui/               디자인 토큰
│   └── voice/            음성 프로바이더 추상화
└── docs/                 프로젝트 문서
```

## 빠른 시작

### Backend

```bash
cd packages/backend
npm install
npm run dev        # wrangler dev --env dev
npm test           # vitest
npm run deploy     # wrangler deploy --env production
```

시크릿은 `packages/backend/.dev.vars.dev`와 `packages/backend/.dev.vars.prod`에 로컬로만 두세요(커밋 금지). 전체 목록은 [`docs/tech/`](docs/tech/README.md) 참조.

### Android

```bash
cd apps/android-native
./gradlew :app:assembleDebug
./gradlew :app:testDebugUnitTest
./gradlew :app:installDebug
```

Android SDK가 자동 감지되지 않으면 `apps/android-native/local.properties`를 만들어 `sdk.dir=...`를 추가합니다(gitignore됨).

### iOS (macOS 전용)

```bash
cd apps/ios-native
brew install xcodegen
xcodegen generate
open AlarmTalkNative.xcodeproj
```

## 절대 원칙

1. 알람 울림 경로는 **OS-네이티브 스케줄링 + 로컬 오디오**만 사용합니다. 푸시·서버 cron·울림 시점 네트워크 fetch 금지.
2. 음성 클론과 1회성 TTS는 사용자의 명시적 액션에서만 시작합니다. 사용자가 비공개 draft를 미리 듣고 명시적으로 keep한 경우, 그 1회 액션은 문서화된 프리셋 매니페스트를 렌더하는 고정·유한·durable한 백그라운드 잡 1개를 승인할 수 있습니다. 자율 스캔이나 무제한 AI 작업은 금지되며, 자동 테스트는 유료 프로바이더를 항상 스텁으로 대체합니다.
3. 음성 데이터는 가족·연인 그룹 내부에서만 공유합니다. 외부 다운로드는 설계상 차단됩니다.

## 문서

전체 문서 인덱스는 [`docs/README.md`](docs/README.md) 참조.

## 보안

취약점 제보·지원 버전 정책은 [`SECURITY.md`](SECURITY.md) 참조.

## 라이선스

MIT — [`LICENSE`](LICENSE) 참조.
