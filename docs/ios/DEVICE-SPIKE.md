# 실기기 Go/No-Go 스파이크 — 절차만

**시뮬레이터로는 검증할 수 없는 것들이다.** 코드는 손대지 않았고, 여기 절차만 적어 둔다.
iOS 26 실기기 + Apple Developer Program 계정이 있어야 한다
([`APPLE-ACCOUNT-SETUP.md`](APPLE-ACCOUNT-SETUP.md) 먼저).

왜 시뮬레이터로 안 되는가: 시뮬레이터는 알람 발사·잠금화면 점유·앱 종료 후 동작을
신뢰성 있게 재현하지 못한다. AlarmKit 은 iOS 26 신규 프레임워크라 특히 그렇다.

---

## 준비

```bash
cd apps/ios-native && xcodegen generate
xcodebuild -project AlarmTalkNative.xcodeproj -scheme AlarmTalk -configuration Debug \
  -destination 'platform=iOS,name=<기기 이름>' \
  DEVELOPMENT_TEAM=<Team ID> build
```

기기를 맥에 연결하고 Xcode → Window → Devices and Simulators 에서 신뢰 처리.
첫 실행 시 기기에서 설정 → 일반 → VPN 및 기기 관리 → 개발자 앱 신뢰.

---

## ★ 1. 번들 동봉 `.caf` 가 알람음으로 재생되는가 — **최우선**

**이게 X 면 무료 티어조차 성립하지 않는다.** 제품 정의부터 다시 봐야 한다.

무료·기본 목소리는 서버가 만든 스톡 클립(`packages/backend/src/lib/stock-clips.ts`,
시스템 보이스 4 × 12문구 × 3언어 = 144개)을 쓴다. 이걸 앱 번들에 동봉하고
`AlertConfiguration.AlertSound.named(_)` 로 넘기는 경로가 살아 있어야 한다.

**절차**
1. `.caf` 하나를 앱 번들 리소스로 추가한다(길이 30초 이내).
2. AlarmKit 알람을 1~2분 뒤로 예약하면서 `AlertSound.named("그 파일 이름")` 을 준다.
3. 앱을 **강제 종료**하고 기기를 잠근다.
4. 정시에 **그 소리로** 울리는지 본다.

**판정**
- ⭕ 울린다 → 무료 티어 성립. 2안(번들 스톡클립)을 기본선으로 확정한다.
- ❌ 기본 알람음으로 울리거나 무음 → **전면 재검토.** 대안은 아래 「2안이 죽었을 때」.

## 2. `Library/Sounds` 에 **런타임으로 쓴** `.caf` 가 재생되는가

유료 티어(내 클론 목소리·공유받은 목소리)의 핵심이다. 옛 코드
(`AlarmSoundStaging.swift`)가 App Group 오디오를 `Library/Sounds/voice-<key>.caf` 로
복사·트랜스코드한 뒤 `AlertSound.named(_)` 로 넘긴다.

⚠ **Apple 이 이 경로를 "known issue" 라고 답한 상태다**
([포럼 798140](https://developer.apple.com/forums/thread/798140), 2026-02 댓글에도 미해결).
그러니 **된다고 가정하지 말 것.**

**절차**: 1번과 같되, 번들이 아니라 런타임에 `Library/Sounds/` 로 쓴 파일을 지정한다.

**판정**
- ⭕ → 1안까지 간다. 단 **2안 경로를 코드에서 지우지 말 것** — 30초 초과·트랜스코드
  실패·staging 실패에서 항상 필요하고, 26.x 마이너에서 회귀할 수 있다.
- ❌ → 유료 티어의 약속이 바뀐다. "알람을 끄면 그 사람이 말을 겁니다" 로 재정의
  (AlarmKit 은 번들 톤으로 울리고, 해제 시 `LiveActivityIntent` + `openAppWhenRun` 으로
  앱을 띄워 개인 목소리 재생). **스토어 문구·온보딩에서 두 티어의 약속이 다름을 숨기지 말 것.**

## 3. 커스텀 사운드가 반복되는가, 1회인가

안드로이드는 `VOICE_REPEAT_GAP_MS=900` 으로 무한 반복하고 `LoudnessEnhancer(+6dB)` 를 건다.
iOS 커스텀 사운드는 1회 재생이라는 보고가 많다.

- 1회면: 잠들어 있는 사람을 깨우기에 충분한지 실사용으로 판단해야 한다.
  짧은 클립(~13초)이면 특히 위험하다.

## 4. 체감 볼륨이 실용적인가

"직접 재생보다 작다" 는 보고가 다수. 무음 스위치·방해금지 상태에서도 확인한다.

⚠ **"무음 스위치·방해금지를 뚫습니다" 는 AlarmKit 일 때만 참이다.** 폴백 모드
(앱을 띄워 재생)에서는 거짓이므로 그 문구를 그대로 쓰면 안 된다.

## 5. 예약 → 앱 강제 종료 → 잠금 → **정시에 우는가**

이 앱의 존재 이유다. 5~45분 지연 보고가 있으니 여러 번, 여러 시간대로 확인한다.

- 반복 알람(`.relative(.weekly)`)도 별도로 본다.
- 기기 재부팅 후에도 예약이 살아 있는지 본다.

## 6. (있으면) Sign in with Apple · 인앱결제

- Sign in with Apple: 실제 Apple ID 로 로그인 → 서버가 `POST /auth/apple` 에서
  JWKS 검증을 통과하는지. '나의 이메일 가리기' 도 따로 본다.
- 인앱결제: 샌드박스 계정으로 구독 구매 → `POST /billing/apple/confirm` 이
  `originalTransactionId` 로 구독을 만드는지. 갱신 시 **새 구독이 생기지 않는지**가 핵심.

---

## 2안(번들 클립)이 죽었을 때 — 대안

1번이 ❌ 로 나오면 iOS 에서 "내가 고른 목소리로 울린다" 를 알람 사운드로는 못 한다.
남는 선택지:

1. **해제 후 재생으로 제품을 재정의한다.** AlarmKit 은 시스템 톤으로 울리고,
   사용자가 알람을 끄면 그 순간 앱이 떠서 목소리가 나온다.
   *"알람을 끄면, 그 사람이 말을 겁니다."* — 안드로이드
   `RingingService.startDismissVoiceThenFinish`(719-757)에 이미 있는 동작을 기본 경험으로
   승격하는 것이라 새 발명이 아니다.
2. **iOS 를 무료 티어 없이 낸다.** 유료 약속만 남기면 티어 간 문구 충돌이 없다.
3. **iOS 를 보류한다.** 안드로이드 리텐션·결제 숫자가 한 달치 쌓인 뒤 다시 계산한다.

어느 쪽이든 **코드 결정이 아니라 제품 결정**이고 가격·스토어 문구·온보딩이 따라온다.

---

## 결과 기록

| 항목 | 결과 | 메모 |
|---|---|---|
| 1. 번들 `.caf` 재생 | ⬜ | |
| 2. `Library/Sounds` 재생 | ⬜ | |
| 3. 반복 여부 | ⬜ | |
| 4. 체감 볼륨 | ⬜ | |
| 5. 종료·잠금 후 정시 발사 | ⬜ | |
| 6. Apple 로그인 / 결제 | ⬜ | |
