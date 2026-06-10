# 알람톡

> [English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md)

**알람톡**은 OS-네이티브 음성 알람 앱입니다. 정해둔 시간에 사용자가 고른 목소리 — 직접 녹음한 음성, 업로드한 클립, 가족·연인이 공유한 음성, 또는 AI로 클론한 음성 — 으로 실제 알람을 울립니다.

## 왜 "진짜" 알람인가

대부분의 음성 알람 앱은 푸시 알림이나 서버 cron에 의존하기 때문에 비행기 모드, Doze, 약한 네트워크에서 알람이 조용히 실패할 수 있습니다. 알람톡은 OS-네이티브 알람 스케줄러로 울리고 로컬에 캐시된 오디오만 재생하므로 울림 경로는 네트워크가 필요 없습니다.

## 현재 상태

- **버전**: `v0.1.0` (Closed Beta 준비)
- **브랜치**: `develop`
- **Android**: Phase 1–6 구현 완료, 실기기 검증 완료
- **iOS**: AlarmKit (iOS 26+) PoC 진행 중
- **Backend**: Cloudflare Workers + Hono + Turso 배포 완료

## 기술 스택

| 영역 | 스택 |
|---|---|
| Android | Kotlin 2.0 · Jetpack Compose · Material 3 · Room · DataStore · Retrofit · WorkManager · `AlarmManager.setAlarmClock` |
| iOS (PoC) | Swift · SwiftUI · AlarmKit · ActivityKit (Live Activity) |
| Backend | TypeScript 6 · Hono 4 · Cloudflare Workers · Zod · Vitest |
| Database | Turso (libSQL / SQLite) |
| Storage | Cloudflare R2 (결정적 TTS 캐시) |
| Voice AI | ElevenLabs Instant Voice Clone + TTS |
| Auth | JWT (HS256, 7일) · Google ID 토큰 · Apple ID 토큰 |
| Landing | 정적 HTML + Tailwind CDN + Iconify (`apps/landing`) |

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
2. 음성 AI 호출(클론·TTS)은 사용자의 명시적 액션에서만 발생하며, 백그라운드 작업이나 자동 테스트에서는 호출하지 않습니다.
3. 음성 데이터는 가족·연인 그룹 내부에서만 공유합니다. 외부 다운로드는 설계상 차단됩니다.

## 문서

전체 문서 인덱스는 [`docs/README.md`](docs/README.md) 참조.

## 보안

취약점 제보·지원 버전 정책은 [`SECURITY.md`](SECURITY.md) 참조.

## 라이선스

MIT — [`LICENSE`](LICENSE) 참조.
