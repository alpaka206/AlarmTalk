# Dev 테스트 핸드오프 (갱신 2026-08-11)

> 세션 재개용 라이브 문서. 상태가 바뀌면 이 파일을 갱신/정리한다. (다른 컴퓨터에서도 `git pull` 후 이 문서만 읽으면 이어서 진행 가능.)
> 끝난 검증은 여기 남기지 않는다 — 남은 것과 다음에 또 쓸 방법만 둔다.

## 0. 진행 중 — 클립 선다운로드 5단계 (2026-08-18 새벽 작업)

목표: **알람을 만들 때 쓸 클립이 전부 폰에 있다** → 라이브 생성 폴백이 필요 없어진다.
규약은 [`docs/spec/voice-and-message.md`](../spec/voice-and-message.md) 「미리 받아 둔다」 절.

| 단계 | 상태 | 커밋 |
| --- | --- | --- |
| 1. 클론도 사전렌더를 쓴다(iOS) + 세트 크기를 서버가 정한다 | **완료** | `ae0e4e7a` |
| 2. 내가 등록한 목소리 프리셋을 선다운로드 대상에 | **완료** | `88f8180c` |
| 3. 준비 페이지(생성+다운로드 합산 %) | **화면까지 완료** | `54394cb4` `38b74419` `ab233b06` `5a2bf4c2` |
| 4. 관문 — 못 받은 목소리는 고를 수 없다 | **완료(양 앱)** | `bbbecc80` `cf686c2d` |
| 5. 라이브 생성 제거 | 남음 | — |

### 지금 남은 것 (정확히 셋)

1. **안드로이드 관문 배선** — 판정·화면·파라미터는 다 있고, `VoiceAudioCard` 의
   `onNeedsClipPreparation` / `onOpenClipPreparation` 에 **아직 아무도 값을 안 넘긴다**
   (기본값이 '막지 않음' 이라 현재 동작은 예전 그대로). 넘길 값:
   - 판정: iOS `needsPreparation` 과 같은 규칙 — 시스템 목소리·직접 입력·매니페스트
     미수신은 통과, 그 외에는 `ClipReadiness` 로 그 목소리가 완전한지 본다.
   - 화면: `ClipPreparationScreen(voices = viewModel.clipReadiness, onRetry = …)`,
     상태 갱신은 `MainViewModel.refreshClipReadiness()`.
2. **백그라운드 진행 표시**
   - 안드로이드: **완료**(`23f6cac2`). 워커가 진행률 알림을 띄운다.
   - iOS: **껍데기만 완료.** `Shared/ClipPrefetchActivityAttributes.swift` 와
     `AlarmTalkWidget/ClipPrefetchLiveActivity.swift` 는 들어가 있고 번들에도 등록됐지만,
     **아직 아무도 시작·갱신하지 않는다.**
     ⚠ 막힌 지점: `StockClipPrefetcher` 에서 `Activity.update/end` 를 부르면 Swift 6
     동시성 검사가 `sending 'activity' risks causing data races` 로 막는다(`Activity` 가
     Sendable 이 아니다). `@MainActor` 로 감싸거나 `Task` 로 미뤄도 같은 에러다.
     시도한 것: async 화, `Task { @MainActor in }`, 제네릭 명시 — 전부 같은 지점에서 막힘.
     다음 시도 후보: Activity 조작만 하는 별도 `actor`/`@unchecked Sendable` 래퍼로 감싸기,
     또는 `Activity.activities` 로 매번 찾아 쓰되 그 호출을 nonisolated 컨텍스트에 두기.
3. **5단계: 라이브 생성 제거** — 위 둘이 끝나야 안전하다. 대상은 iOS
   `DynamicVoiceRefreshService` + 안드로이드 동적 갱신 워커 + 편집기 라이브 폴백 +
   서버 랜덤 생성 갈래. **한쪽만 지우면 두 앱이 갈라진다.**

### 3단계에서 남은 것 — **화면**

계산은 끝났다(양 앱 `ClipReadiness`, 각 8건 테스트·같은 기대값 표). 남은 것은 그리는 쪽이다.

**이미 있어서 새로 만들지 않아도 되는 것** (이 목록을 먼저 볼 것 — 중복 구현 방지):

| 필요한 것 | 이미 있는 것 |
| --- | --- |
| 진행률 값 | `ClipReadiness.percent(...)` (양 앱) |
| 목소리별 렌더 상태 | iOS `AlarmTalkAPI.voicePrerenderStatus(id:token:)` → `{status, total}`. 안드로이드도 같은 라우트를 이미 호출한다 |
| 다운로드 진행 | iOS `StockClipPrefetcher.state` = `.running(done:total:)`. 안드로이드 `StockClipPrefetchWorker` 가 `setProgress(progressData(done, total))` 로 이미 낸다(WorkManager 로 관찰) |
| 퍼센트를 그리는 예 | iOS `Views/Auth/VoiceSetupView.swift` 가 `.running(done,total)` 을 이미 표시한다 — 이 화면의 표현을 재사용 |
| 재시도 | `POST /voice/:id/prerender-retry` — 양 앱의 목소리 관리 화면 버튼이 이미 호출한다 |
| iOS 잠금화면 진행 | `AlarmTalkWidget/AlarmLiveActivity.swift`(알람용). **같은 위젯 확장에 Activity 를 하나 더** 추가하는 형태 |

**연결 순서 제안**: (1) `ClipReadiness.evaluate` 에 넣을 입력을 모으는 얇은 뷰모델
(대상 목소리 = 기본 전부 + `ownedVoiceProfileIDs`, 카테고리, 캐시 여부) →
(2) 그 값을 그리는 페이지 → (3) 백그라운드 진행 표시(알림 / Live Activity) → (4) 재시도 버튼.
(1)까지 하면 4단계 관문이 바로 붙는다.

- **준비 페이지**: `ClipReadiness.percent` 하나를 크게. 목소리별 진행/실패도 함께.
- **백그라운드 진행**: 페이지를 떠나도 계속 받고, 진행률이 폰에서 보여야 한다.
  - 안드로이드: 포그라운드 서비스 + 진행률 알림
  - iOS: **Live Activity**(진행률 알림이 없다. 인프라는 `AlarmTalkWidget/AlarmLiveActivity.swift` 에 이미 있다)
- **재시도**: 서버 생성 실패는 `POST /voice/:id/prerender-retry`(양 앱이 이미 호출한다 —
  목소리 관리 화면의 버튼을 이 페이지에서도 쓴다), 다운로드 실패는 그 클립만 다시.
- **안드로이드에 `ClipReadiness` 대응이 아직 없다** — 같은 계산을 옮기고 같은 기대값으로 테스트를 건다.

### 4단계 — 관문
- 편집기 진입 시 준비가 안 됐으면 준비 페이지로. ⚠ **알람 만들기 자체를 막지 않는다**
  (오프라인이면 이미 받은 것으로 진행. 막는 것은 **목소리 등록**뿐).
- **공유받은 목소리**는 선다운로드 대상이 아니다 — 알람에서 **고르는 순간** 없으면 모달 →
  준비 페이지. 그 목소리만 잠그고 나머지로는 알람을 만들 수 있어야 한다.

### 5단계 — 라이브 생성 제거
1~4가 끝나야 판단할 수 있다. 지금 지우면 사전렌더가 안 끝난 목소리로 알람을 못 만든다.
대상: iOS `DynamicVoiceRefreshService`(+ 안드로이드 동적 갱신 워커), 편집기의 라이브 폴백,
서버의 랜덤 생성 갈래. **한쪽만 지우면 두 앱이 갈라진다.**

## 1. 남은 것 = 실기기 검증 체크리스트

### ① 사전렌더 라이브 (dev 배포됨, 유료 계정 필요)
- [ ] 클론 목소리 등록(keep/promote) → cron(`*/5`)이 **21클립** 렌더: greeting 1 / weather 9(조건 8 + 미해결 안내 1) / fortune 5 / love 3 / medication 3, 앱 언어 1개. 틱당 6클립이라 완성까지 ~20분.
- [ ] 편집기에서 날씨/운세/사랑/약 각각 선택·저장 → 클론 버킷 부착(`hasCompleteCloneBucket`, weather 9개 풀셋 요구).
- [ ] **비행기모드 발사**: 그 목소리 클립 재생 + 잠금화면 문구가 재생 오디오와 같은 인덱스로 일치.
- [ ] 날씨 미해결(준비창에 인터넷 없음) 시 '맑음' 오재생 대신 **마지막 안내 클립**("인터넷이 안 돼서 날씨를 미리 확인 못 했어요" 톤) 재생.

### ② FCM 가족 알람 즉시배달
- [ ] 양 폰 모두 앱 1회 실행(토큰 등록: `POST /api/push/register`) → S23 발신, **A32 백그라운드**에서 수 초 내 수신(data-only push → 즉시 pull → Room 반영 + 수신 알림).
- [ ] 로그아웃 시 언레지스터(`/api/push/unregister`) 동작.
- [ ] 탈퇴 철회 후 재로그인 시 토큰 재등록.
- (폴백: 앱 포그라운드 복귀 시 60초 스로틀 즉시 pull + 15분 WorkManager 주기는 그대로 살아있음.)

### ③ 울림화면(RingingActivity) 실발사
- [ ] 실제 알람 발사로 잠금화면 위에 뜨는지(문구 표시·노브 화살표 포함). `am start` 는 exported=false 라 차단 — 실발사 필요.
- **규칙: 18시 이전엔 알람 울리게 하지 말 것.** 설정은 OK, 발사는 18시 이후.
- 무음·무진동 발사법: A32 알람볼륨 0 + 진동패턴 OFF로 생성 → `adb shell am broadcast -a com.alarmtalk.app.action.ALARM_TRIGGER --es com.alarmtalk.app.extra.ALARM_ID <id> -n com.alarmtalk.app.dev/com.alarmtalk.app.alarm.AlarmReceiver`. 로컬 id 는 아래 §3 으로 뽑는다.

### ④ 등록 미리듣기
- [ ] 미리듣기 문구가 관계·호칭에 톤 적응돼 생성되는지.
- [ ] 재생 결정성: 같은 draft 재생 시 저장된 `preview_text` 재사용(재생성 없음), 동시 첫-미리듣기 레이스에서도 문구 1개로 수렴.

### ⑤ 직전 선택 유지 (새 알람 기본값)
규약: [`CLAUDE.md` 「알람 편집기 기본값 = 직전 선택 유지」](../../CLAUDE.md). **기억은 알람 저장 성공 시에만**, 적용은 **새 알람에만**.
- [ ] 클론이 있는 계정에서 **기본(시스템) 목소리**로 알람 저장 → 새 알람이 그 시스템 목소리로 열린다(내 클론으로 되돌아가지 않는다).
- [ ] 유료 클론에서 문구 '사랑' 저장 → 새 알람이 '사랑'으로 열리고, **문구 pane 을 열어도 '사랑'이 체크**돼 있다(예전엔 '약'으로 보였다).
- [ ] **저장한 그 알람을 다시 열면** 문구 행이 '사랑'이고 pane 도 '사랑'에 체크돼 있다(2026-08-05 이전엔 행 '기본 인사말' / pane '직접 입력'이었다). 사전렌더가 끝난 클론이어야 버킷 경로를 탄다 — 라이브 생성으로 폴백하면 이 버그가 안 보인다.
- [ ] **이 수정 전에 만든 알람**(종류 null + 버킷만 있는 행)을 열어도 버킷대로 보인다 — greeting→기본 인사말 / love→사랑 / medication→약 / fortune→운세 / weather→날씨.
- [ ] 무료/기본 목소리에서 테마를 '날씨'로 저장 → 새 알람이 '날씨'로 열린다(매번 '약'으로 돌아가지 않는다). 저장된 도시가 없으면 '약'으로 폴백하는 게 정상.
- [ ] 문구 pane 에서 종류만 바꾸고 **저장하지 않고 나가면** 다음 새 알람에 반영되지 않는다.
- [ ] **기존 알람을 열었다 닫아도** 목소리·문구·테마가 변하지 않는다.
- [ ] 직접 입력 문구가 있는 기존 알람을 열어 **시각만 바꿔 저장** → 문구가 그대로 남는다(대괄호 포함 문구도 안 잘린다).
- [ ] **직접 입력으로 저장 → 새 알람이 그 문구가 담긴 직접 입력으로 열린다**(2026-08-06 변경, 그전에는 직전 생성형으로 되돌아갔다). 문구 요약 행에 `직접 입력 · 문구…` 로 보이고, **저장이 바로 눌린다**(재생성·한도 차감 없음 — 비행기모드에서도 저장된다).
- [ ] 그 뒤 생성형(사랑 등)으로 한 번 저장 → 새 알람이 '사랑'으로 열린다(직접 입력 기록이 지워진다). 마지막 선택은 **둘 중 하나만** 남는다.
- [ ] 로그아웃 → 다른 계정 로그인 → 새 알람이 기본 인사말/약으로 시작하고 **앞 계정이 쓴 직접 입력 문구가 안 보인다**. 자동 401 후 같은 계정 재로그인은 **유지**되는 게 정상.

### ⑤-1 문구 화면 — 다시 묻지 않기 / 모달 닫힘 범위
- [ ] 지역·사주가 이미 등록된 상태에서 '날씨'/'운세'를 **다시 눌러도 입력창이 뜨지 않는다**(선택만 된다).
- [ ] 등록된 적 없으면 고르는 순간 입력창이 뜬다(안 뜨면 저장이 왜 막히는지 알 수 없다).
- [ ] 값을 고치는 길은 리스트 아래 상세 카드의 **'변경하기'** 하나다 — 날씨·운세·직접 입력 셋 다.
- [ ] 다이얼로그에서 **확인/닫기 어느 쪽이든 문구 목록은 그대로 남는다**(예전엔 목록까지 닫혔다). 반영은 문구 화면의 저장 버튼을 눌러야 일어난다.
- [ ] 직접 입력 문구가 길 때: 상세 카드는 **전문**, 편집기 요약 행은 **한 줄 말줄임**.

### ⑥ 음성 생체정보 동의 철회 (되돌릴 수 없음 — 유료 계정 필요)
- [ ] 더보기 → 약관 및 동의 → 선택 동의의 '동의 철회' → **확인 모달에서 취소** 시 아무 일도 일어나지 않는다.
- [ ] 철회 확정 → 목소리 목록이 비고, 그 목소리로 울리던 알람이 기본 알람음으로 바뀐다. 화면의 동의 상태가 '미동의'로 갱신된다.
- [ ] **공유받은 가족 기기**에서도 강등이 반영된다(FCM `voice_access_revoked`, 미수신 시 앱 재실행으로 폴백).
- [ ] 철회 후 목소리를 다시 등록하면 동의 시트가 떠서 재동의가 정상 동작한다.
- [ ] 국외 이전 행에는 철회 액션이 없고, 아래 안내가 회원 탈퇴로 유도한다.

### ⑦ 녹음 길이 (하한 12초)
- [ ] 12초를 갓 넘긴 녹음으로 **정식 등록이 통과**한다(예전 1분 하한이 남아 있지 않다).
- [ ] 2분을 넘기면 여전히 막힌다. 파일/영상 업로드도 같은 기준.

### ⑧ 같은 문구 재사용
- [ ] 직접 입력 문구로 알람 A 저장 → 새 알람 B 에 **글자까지 같은 문구** 입력 → 저장이 즉시 끝나고(생성 대기 없음) 월 한도가 안 깎인다.
- [ ] **비행기모드**에서도 같은 문구면 저장된다.
- [ ] 문구를 한 글자라도 바꾸면 정상적으로 새로 생성된다.

### ⑨ 모달·아이콘 개편
알럿 껍데기 3종을 `IosAlertDialog` 하나로 합치고 브랜드 이미지를 교체한 작업.
**코드는 `feat/ios-revive` 에 들어와 있다** — 예전엔 `fix/welcome-promo-modal-style`
브랜치를 가리켰는데 그 브랜치는 사라졌다(2026-08-11 정정). 화면 확인은
S23 Ultra·A32 두 대에서 끝냈다(웰컴 프로모·닉네임·스누즈 직접입력·직접문구·목소리 이름 변경,
운세 생년월일 드롭다운·윤년 클램프). 아래만 남았다.

- [ ] **런처 아이콘**: 홈 화면·앱 서랍·최근 앱에서 새 로고로 보이고, 원형 마스크/적응형
      확대에서 가장자리 배경(`#0448E6`)이 튀지 않는다. 기기 캐시 때문에 재설치만으로는
      안 바뀔 수 있다 — 안 바뀌면 삭제 후 설치.
- [ ] **구글 재로그인 닉네임 유지**(백엔드 변경, dev 배포 후): 닉네임을 바꾸고 로그아웃 →
      같은 구글 계정으로 다시 로그인 → **바꾼 닉네임이 그대로**다(예전엔 구글 프로필
      이름으로 되돌아갔다).
- [ ] **코드 길이 상한**: 64자 넘는 코드를 직접 호출로 보내면 `CODE_TOO_LONG` 400.

## 1-B. iOS 실기기 검증 (2026-08-06 전수 대조 이후)

시뮬레이터로 확인한 것은 여기 남기지 않는다 — **실기기가 있어야만** 판별되는 것만 둔다.

### ⓐ 잠금화면·앱 종료 상태에서 목소리가 울리는가 ← **가장 중요**
`AlarmSoundStaging` 이 `AVAssetExportPresetAppleM4A` 로 `.caf` 를 굽고 있었는데 그
프리셋은 `.caf` 를 못 낸다 — staging 이 **항상** 실패해 잠금화면·백그라운드에서 목소리
대신 시스템 톤만 울렸다. `AVAssetReader`→`AVAssetWriter`(CAF/LPCM)로 바꿨고 시뮬레이터
단위 테스트(`AlarmSoundStagingCapabilityTests`)는 통과하지만, **실기기에서 실제로 울리는지는
아직 확인 못 했다.**
- [ ] 앱을 완전히 종료하고 알람 발사 → 목소리 재생
- [ ] 기기 잠금 상태에서 발사 → 목소리 재생
- [ ] 30초 넘는 클립이 앞 30초로 잘려 재생되는지(AlarmKit 한도)

### ⓑ 앱 실행 직후 권한 팝업
시뮬레이터에서 앱을 켜자마자 AlarmKit 권한 팝업이 떴다. 알람을 만들기도 전에 묻는
셈이라 안드로이드의 "게이트는 알람 기능을 쓸 때" 규칙과 어긋난다.
- [ ] 실기기에서도 켜자마자 뜨는지 확인 → 뜬다면 `AlarmManager.alarmUpdates` 구독을
      권한 허용 이후로 미루는 것을 검토(구독 자체가 프롬프트를 유발하는지부터 확인).

### ⓒ 등록 확인 스텝(초안 → 승격)
서버 계약대로 `isDraft=true` 로 만들고 미리듣기를 끝까지 들어야 저장이 열리게 했다.
서버 왕복이 필요해 시뮬레이터에서는 못 봤다.
- [ ] 등록 → 미리듣기 자동 재생 → 끝까지 들으면 '저장하기' 활성
- [ ] 문구 수정 → 저장 다시 잠김 → 새 문구로 재생 후 활성
- [ ] '다시 만들기' → 초안 삭제 + 이번 달 등록 횟수 **차감 없음**

### ⓓ 사전렌더 진행 표시
- [ ] 유료 클론 등록 직후 목소리 행에 '알람 음성 준비 중 n%' → 완료 시 사라짐
- [ ] 실패 상태에서 '다시 시도' 가 실제로 큐를 되살리는지
- [ ] 큐가 없는 상태(`none`)에서 "준비 중 0%" 가 **뜨지 않는지**

### ⓔ 목소리 이름 변경 (409 회귀)
- [ ] 등록 끝난 목소리의 이름을 바꿔 저장 → 성공(예전에는 관계·호칭을 함께 보내
      409 `VOICE_PERSONA_LOCKED` 로 이름 변경조차 실패했다)

### ⓕ 생체정보 동의 철회 (되돌릴 수 없음 — 유료 계정 필요)
- [ ] 더보기 → 설정 → 법적 정보 → 약관 및 개인정보 처리 동의 → 음성 생체정보 '동의 철회'
- [ ] 서버 목소리 삭제 + **그 기기의 알람이 기본 알람음으로 강등**되는지(응답 직후
      세션 가드보다 먼저 끊는다)

### ⓕ-2 편집기 컨트롤 (2026-08-11 변경 — 실기 1차 확인은 끝)

시뮬레이터/실기 캡처로 확인했고, 아래만 **손으로 만져 봐야** 판별된다.
규칙은 [`docs/spec/alarm-editor.md`](../spec/alarm-editor.md) 가 단일 출처다.

- [ ] 휠을 **세게 튕겼을 때** 숫자가 굴러가다 멎는 감이 두 앱에서 비슷한가(같은 곡선·시간표를 쓴다).
- [ ] 굴러가는 중에 **손을 대면 그 자리에서 잡히는가**(남은 칸을 마저 넘기지 않는다).
- [ ] 숫자를 눌러 고쳐 쓸 때 키보드가 휠을 가리지 않는가(작은 화면 — A32).

### ⓖ 애플 계정 — 출시 전에 사람이 해야 하는 것 (2026-08-10 실측)

키 설정과 검증은 끝났다. **남은 둘은 코드로 못 고친다** — 애플 콘솔에서 해야 한다.
자세한 판정표·검증법은 [`docs/ios/APPLE-ACCOUNT-SETUP.md`](../ios/APPLE-ACCOUNT-SETUP.md).

**끝난 것** — 앱 레코드(`Alarm-Talk`, Apple ID `6799711245`), 상품 4종 등록,
결제 검증 키, 프로덕션 APNs 키(`8S2AH3937P`). 상품 ID 4종이 콘솔 =
`apple-storekit.ts` = `StoreKitConfiguration.storekit` 로 일치함을 대조했다.

- [ ] **dev 워커 APNs 키를 되살린다.** `.dev.vars.dev` 의 키가 양쪽 호스트에서
      `InvalidProviderToken` 이다(Key ID `3CNKCBLC5U` 와 짝이 아니거나 폐기됨).
      **prod 는 정상이라 출시에는 영향 없고, 막히는 건 dev 워커 푸시뿐이다.**
      ① `3CNKCBLC5U` 의 `.p8` 재확보 또는 ② 두 환경 모두 되는 키 하나 발급 후
      dev·prod 양쪽에 같은 값. 자세한 판정표는
      [`docs/ios/APPLE-ACCOUNT-SETUP.md`](../ios/APPLE-ACCOUNT-SETUP.md).
- [ ] **시크릿을 워커로 올린다** — `npm run secrets:sync:dev` / `:prod`.
      (아직 안 올렸다. 배포는 PR 이후이므로 그때 함께.)
- [ ] 실기기에서 **가격이 스토어에서 내려오는지** 확인. 상품 상태가 "제출 준비 중" 이라
      **1.0 빌드와 함께 제출해야** 조회된다.
      - ⚠ **dev 빌드에서는 애초에 안 내려온다**(2026-08-11 로그로 확인). 안드로이드 dev 는
        패키지명이 `com.alarmtalk.app.dev` 라 Play 에게는 **다른 앱**이고, 상품은
        `com.alarmtalk.app` 에 등록돼 있다. 조회는 **성공**하고 상품이 0개로 돌아온다
        (에러 로그가 안 남는 이유). **prod 플레이버로 트랙에 올려야** 확인된다.
      - 가격을 못 받으면 **폴백**(3,900/6,900/14,900)을 보여 준다 — 스토어 값이 오면
        언제나 그쪽이 이긴다. 숫자의 출처는 백엔드 `plans.price_krw` 이고, 앱의
        `FallbackPlanPriceKrw`(안드) / `FallbackPlanPrice`(iOS) 와 **함께** 고쳐야 한다.
      - ⚠ 폴백은 **한국 기준**이라 해외 사용자에게는 틀릴 수 있다. 스토어 가격이 내려오기
        시작하면 이 표가 실제로 쓰이지 않는지 확인할 것.
- [ ] 첫 제출 후 결제 검증 키의 **프로덕션 401 이 풀리는지** 확인. 지금 401 인 건
      키 문제가 아니라 앱이 아직 프로덕션에 없어서다 — 고칠 것 없다.

### ⓗ 성능 — 찾았지만 **고치지 않은** 것 (2026-08-10)

고칠 수 있는 건 고쳤고(백엔드 인덱스 6개, iOS 경고 79→5), 아래 둘은 **실기기 검증
없이 손대면 더 위험해서** 남긴다. 근거와 판단을 함께 적어 둔다.

- [ ] **iOS `AlarmSoundStaging` 이 메인 스레드를 막는다.** `@MainActor` 인데 내부에서
      `AVAssetReader`→`AVAssetWriter` 변환을 `DispatchSemaphore.wait()` 로 **동기 대기**
      한다(`stage(url:key:)`). 새 오디오마다 한 번씩(파일이 이미 있으면 건너뛴다) 알람
      저장·동기화 중 UI 가 그 시간만큼 멈춘다.
      - **왜 안 고쳤나**: 비동기로 바꾸면 *예약*과 *스테이징*의 순서가 바뀐다. 이 파일은
        전에 `AVAssetExportSession` 을 쓰다가 **잠금화면·앱 종료 상태에서 목소리가 아예
        안 울리게** 만든 이력이 있다(CLAUDE.md 참조). 시뮬레이터로는 그 경로를 검증할 수
        없어, 확인 못 할 변경으로 가장 중요한 기능을 걸 수 없다.
      - **고칠 때**: 변환만 background executor 로 내리고 `stage` 를 async 로 바꾼 뒤,
        §1-B ⓐ(잠금화면·앱 종료 상태 울림)를 실기기로 반드시 재확인할 것.
- [ ] **안드로이드에 baseline profile 이 없다.** `androidx.profileinstaller` 의존성도
      `baseline-prof.txt` 도 없다. Compose 앱에서 저사양 기기 콜드스타트·스크롤 자레지를
      줄이는 표준 수단이라 A32 같은 기기에 특히 효과가 크다.
      - 제대로 만들려면 macrobenchmark 모듈에서 기기 실행으로 프로파일을 **생성**해야 한다.
        손으로 쓴 프로파일은 효과가 없거나 역효과라 그 절차를 건너뛸 수 없다.

> ⚠ **디버그 빌드 자레지 수치를 릴리스로 읽지 말 것.** 2026-08-10 A32 실측에서 탭 전환
> 326프레임 중 293(89.9%)이 자레지였지만 **devDebug 빌드**다(GPU 는 50th 14ms 로 여유,
> UI 스레드가 270프레임 느림). Compose 디버그 빌드는 R8 미적용 + 컴포지션 추적이 붙어
> 릴리스와 크게 다르다. 릴리스로 재보려면 `devRelease` 를 설치해야 하는데 서명이 달라
> **debug 앱을 지워야 하고 로그인 세션이 날아간다** — 그래서 이번엔 측정하지 않았다.

## 1-D. 릴리스 때 **반드시 같이** 해야 하는 것 (2026-08-11 추가)

- [ ] ⚠ **`CURRENT_POLICY_VERSION` 을 5 → 6 으로 올린다**(`packages/backend/src/lib/consent.ts`).
  개인정보 처리방침에 **「유료 이용권 종료 시 목소리 3일 보관 후 파기」** 절을 새로 넣었기
  때문이다(`docs/legal/privacy-policy.ko.md`). **지금은 일부러 올리지 않았다** —
  CLAUDE.md 「법무 문서 버전」 규약대로 **새 문서를 번들한 앱이 스토어에 게재된 뒤**
  서버 상수를 main 에 머지해야 한다. 순서를 뒤집으면 `POST /user/consents` 가 전부
  **409 POLICY_VERSION_MISMATCH** 로 막혀 **신규 가입과 재동의가 통째로 멈춘다.**
  - iOS·안드로이드를 같이 올리므로 그 릴리스에서 한 번에 처리한다.

## 1-E. 유료 게이트 통합 (2026-08-11 지시, **다음 세션에서 이어서**)

사장님 지시 원문 그대로:
- 유료 게이트 설명을 **한 문구로 통일**: `해당 기능은 유료 이용권에서 사용할 수 있어요.`
  (녹음 / 직접 입력 / 목소리 추가 **그리고 그 밖에 유료 게이트가 뜨는 모든 곳**)
- **'쿠폰이 있어요' 버튼을 항상** 함께 둔다.
- ⚠ **유료 게이트에만 적용한다** — 그 외 모달(월 한도 안내·로그인 필요·삭제 확인)은 건드리지 않는다.
  게이트("유료여야 한다")와 그 밖("이미 유료인데 이번 달을 다 씀")은 **다른 사실**이다.
- **각각 만들지 말고 공용 컴포넌트 하나로** 재활용 — 한 곳에서 관리.

**같이 할 것: 알람 편집기의 파일 업로드 제거(iOS)**
- ⚠ **목소리를 만들 때의 파일 업로드는 남긴다**(`VoiceCloneUploadFlow`·`AudioCropper`).
  없애는 건 **알람 편집기** 쪽뿐이다(`AlarmEditorSheet.swift` 의 `fileImporter` ·
  `selectedLocalAudioURL`). 안드로이드 알람 편집기에는 이미 없다(소스 세그먼트를 없앴다).
- ⚠ **녹음(마이크) 경로까지 죽이지 말 것** — 파일 선택과 녹음은 같은 `localAudio` 모드를
  공유하므로 갈라서 지워야 한다.

전수 조사 결과가 워크플로 산출물로 남아 있다(게이트 노출 지점·쿠폰 버튼 위치·
파일 업로드 심볼·무료 안내 문구). 다음 세션은 그 목록부터 확인하고 시작하면 된다.

## 1-F. 유료 게이트 전수 조사 결과 (2026-08-11, 반증까지 마침)

1-E 를 실행하기 전에 이 목록부터 본다. **찾은 것을 다시 찾지 말 것.**

### ⚠ en/ja 기기에 한국어가 그대로 뜬다 (iOS `Localizable.xcstrings` 누락)

| 누락 문자열 | 나오는 곳 |
| --- | --- |
| `유료 이용권이 필요해요` | `AlarmEditorSheet.swift` 무료 게이트 **제목** |
| `기본 목소리로는 직접 입력을 쓸 수 없어요` | 같은 파일, 유료+기본목소리 게이트 제목 |
| `기본 목소리는 준비된 문구로만 …` | 카탈로그엔 **옛 문구**가 en/ja 와 함께 남아 있다(소스만 고친 전형) |
| `이용권을 등록하면 이 목소리로 알람을 만들 수 있어요.` | 저장 버튼 아래 인라인 차단 |
| `직접 녹음` | 목소리 시트 마지막 항목 |

### 사장 코드 (지울 것)

- `Views/Common/PlanGateDialog.swift` — `PlanGateState` **참조 0건**, 게다가 그 파일에
  **다이얼로그 View 자체가 없다**(파일명이 거짓말). 살아 있는 건 `PlanTier` 뿐 →
  `PlanTier.swift` 로 개명.
- 카탈로그 사장 항목 9개(`유료 기능이에요`·`요금제 변경하러 가기`·`이 기능은 무료
  플랜에서도…` 계열) — en/ja 번역까지 붙은 채 남아 있다.
- 안드로이드 `voices_paid_required` ≡ `msg_voice_paid_plan_required` — **글자가 같은 중복 키**.

### 게이트 진입점 (AOS 는 1곳이 아니라 4곳)

`AlarmEditorScreen.kt` 의 `onManualLocked` / PlayModeCard 선택 / `onLockedVoiceClick` /
VoiceAudioCard 토글, 그리고 `saveEditor()` 사전 차단. ⚠ 뒤 넷은 판정이
`voicePlanLocked = authSession == null` 이라 **실질 사유가 로그인**이다 — 유료 게이트와
섞어서 고치면 안 된다.

### 앱 간 불일치 (통일 대상)

| 항목 | 안드로이드 | iOS |
| --- | --- | --- |
| 목소리 게이트의 **쿠폰 버튼** | 있다(`PlanGateDialog(onRedeemCode=…)`) | **없다** ← 요청 3번과 직결 |
| 강등 모달의 '이용권 보기' | 있다(`downgrade_notice_open_billing`) | **없다**(확인 하나뿐) |
| 무료가 보는 '내 목소리' 목록 | **숨긴다**(`ownVoices = emptyList()`) | 그대로 보인다 |
| 저장 전 유료 사유 표시 | 없다(눌러야 스낵바) | 있다(`editorSaveBlockedReason`) |
| 무료가 녹음을 고를 때 | **녹음을 끝낸 뒤** 거절 | 시트에서 자물쇠로 미리 막음 |

### 서버 에러코드 3종이 양 앱 모두 미매핑

`FREE_PLAN_PRESET_ONLY` · `BASIC_VOICE_PRESET_ONLY` · `VOICE_LOCKED_FREE_PLAN` →
지금은 일반 오류 문구로 떨어진다. 매핑 자리: 안드 `MainViewModelVoiceActions` 의 when,
iOS `VoiceStudioViewModel+ErrorMapping` 의 switch + `knownErrorCodes`.

### 미확인 (실기기 필요)

- iOS `presentCreateEntry()` 는 `familyRecipients.isEmpty` 만 보는데 안드는
  `hasCoupleOrFamilyAccess` 를 함께 본다 — 보류(`ON_HOLD`) 상태에서 갈라지는지 미검증.
- 스낵바·알럿의 실제 도달 가능성은 코드 경로로만 판단했다.

## 1-G. 기본 목소리 + 직접 입력 — **서버는 열렸다, 클라가 남았다** (2026-08-11)

지시: "기본 목소리여도 유료면 직접 입력 횟수 차감하면서 쓸 수 있도록."

**서버 완료**(`routes/tts.ts`, dev 배포됨):
- `manualTextOnSystemVoice` — 유료 + 시스템 보이스 + 직접 입력(랜덤 아님, 번역 아님)이면
  프리셋 게이트를 통과한다. 비용은 기존 `reserveManualTtsQuota`(월 한도)가 센다.
- ⚠ **캐시 구멍도 같이 닫았다** — 직접 입력은 `anyUser` 공유를 끈다. 안 끄면 남의
  `messages` 행 id 를 받아 `messageBelongsToCaller` 가 나중에 거절한다(**들리는데 저장이
  안 되는** 그 사고). 덤으로 남의 문구에 얹혀 **한도가 안 깎이는** 창도 닫혔다.
- 테스트: `test/paid-voice-access.test.ts` — 허용 1건 + 번역은 여전히 차단 1건.
  **고의 되돌리기로 검증**(제한 복원 시 빨간불).

**클라 남음 (양 앱)** — 지금은 화면이 여전히 막는다:
- 판정 `restrictToWeatherMedication = freeVoiceTier || isSystemVoiceSelected` 가 **두 가지를
  한 플래그로** 묶고 있다: ① 동적 문구(날씨·운세) 차단 ② 직접 입력 차단.
  **①은 유지, ②만 `freeVoiceTier` 로 좁혀야 한다.**
- ⚠ 단순히 플래그만 바꿀 수 없다. 무료용 `FreeBucketSettingsPane` 에는 '직접 입력'
  다이얼로그가 없고(그 다이얼로그는 유료 pane `AlarmRandomPromptSettings` 안에 있다),
  잠긴 행만 있다. **유료+기본목소리는 어느 pane 을 보여줄지부터 정해야 한다** —
  (a) 무료 pane 에 직접 입력 다이얼로그를 끌어오거나 (b) 유료 pane 을 쓰되 동적 항목을 숨기거나.
  (a) 를 시도했다가 다이얼로그 상태가 다른 컴포저블에 있어 되돌렸다.
- iOS 도 같은 구조(`restrictToWeatherMedication`, `FreeBucketSettings`).

## 1-C. 콘솔 작업 (코드는 끝, 사람이 눌러야 하는 것)

- [x] ~~Sentry 프로젝트 생성 → DSN 발급~~ **2026-08-11 완료.** 세 프로젝트(ios/android/backend)
  DSN 을 각각 넣고 **전송까지 확인**했다:
  - iOS → `apps/ios-native/Local.xcconfig`(gitignore). 시뮬레이터에서 조직 ingest 호스트로
    붙는 것 확인. ⚠ xcconfig 의 `//` 주석 함정 주의 — README 참조.
  - 안드로이드 → `~/.gradle/gradle.properties`(리포 **밖**). logcat 에 `Initializing SDK with DSN` 확인.
    리포 안 `gradle.properties` 는 비워 둔 채로 유지한다(공개 리포).
  - 백엔드 → dev·prod 워커 시크릿 `SENTRY_DSN`(`wrangler secret put`, 단일 키만).
    dev 에 임시 라우트로 500 을 내 전달을 확인하고 즉시 원복했다.
  - 알림은 세 프로젝트 모두 기본 Error Monitor("high priority issues → Email") 활성.
- [ ] **Play Console RTDN**: Pub/Sub 토픽 + push 구독 연결. 없으면 dev 워커가
  `503 RTDN_UNCONFIGURED` 를 돌려준다(구독 전환·해지 알림이 서버에 안 들어온다).

## 2. 예정 기능 (미구현)

0. **정리 감사 백로그**: 안 쓰는 코드·스키마와 현황과 어긋나는 문구/문서 49건 → [`cleanup-audit-2026-08-01.md`](cleanup-audit-2026-08-01.md). 버킷별로 PR 을 나눠 처리한다.
1. **미리듣기 문구 표시 + 수정**: 등록 미리듣기에서 생성된 문구를 화면에 보여주고 수정 가능하게. 수정한 문구는 이후 프리셋 생성 스타일 참고로 사용.
2. **프리셋 준비중 게이트**: 사전렌더가 아직 안 끝난 목소리는 문구 선택기에서 해당 항목 비활성 + "준비 중" 안내. 직접 입력은 항상 가능.

## 3. 기기 Room DB 들여다보기 (실측 메모)

로컬 알람 id·상태를 확인할 때 쓴다. 실패 방식이 전부 **조용해서** 순서를 지켜야 한다.

- **세 파일을 같이, 따로 꺼낸다.** 아직 체크포인트 안 된 변경은 전부 `-wal` 에 있어서 `voice-alarm.db` 만 pull 하면 방금 만든 알람이 안 보인다(행 0개로 보인 적 있음). sqlite 는 세 파일이 **같은 폴더에 같은 이름으로 나란히** 있어야 `-wal` 을 반영한다.
- **`cat ...db{,-wal,-shm} > 한파일` 로 묶지 말 것.** 에러 없이 조용히 틀린다 — 합친 파일은 헤더의 페이지 수만큼만 읽히고 뒤 바이트는 통째로 무시된다(실측: 481,688바이트 중 앞 32,768바이트만 DB 본체). 결국 `.db` 만 꺼낸 것과 같은 '마지막 체크포인트' 스냅샷이 된다.
- **꺼내기 전에 앱을 멈춘다.** 복사 도중 Room 이 체크포인트·WAL 리셋을 하면 서로 다른 시점의 파일 셋이 만들어져 최근 알람이 빠지거나 `no such table` 이 난다. force-stop 이 WAL 을 접어 주므로 그 뒤로는 파일 셋이 얼어 있다.
- ⚠ **force-stop 은 OS 알람 예약을 지운다.** Room 행은 남지만 AlarmManager 예약(PendingIntent)이 날아가 그대로 두면 **안 울린다**. Android 15 부터 문서화된 동작이고([stopped state](https://developer.android.com/about/versions/15/behavior-changes-all#stopped-state)), 실측하면 **Android 13 에서도 이미 그렇다**(A32: 07:00 알람 켬 → `Next alarm clock … 07:00` → force-stop → 해당 줄이 빔 → 앱 재실행 → `Boot restore complete pending=1 scheduled=1` 과 함께 복귀).

순서: ① 관찰하려던 동작을 **끝내고**(결과가 Room 에 써진 뒤) → ② force-stop + 3파일 추출 → ③ **앱 재실행해 예약 복구**(로그 `Boot restore complete pending=N scheduled=N`, `adb shell dumpsys alarm` 의 `Next alarm clock information` 확인).

```powershell
$dst = '<받을 폴더>'
adb -s <serial> shell am force-stop com.alarmtalk.app.dev   # ← 반드시 먼저
foreach ($f in 'voice-alarm.db','voice-alarm.db-wal','voice-alarm.db-shm') {
  adb -s <serial> shell "run-as com.alarmtalk.app.dev cat /data/data/com.alarmtalk.app.dev/databases/$f > /data/local/tmp/$f"
  adb -s <serial> pull "/data/local/tmp/$f" "$dst\$f"
}
adb -s <serial> shell monkey -p com.alarmtalk.app.dev -c android.intent.category.LAUNCHER 1  # ← 예약 복구
```

`>` 는 반드시 **바깥 adb 셸**이 처리하게 둔다(위 형태). `run-as ... sh -c '... > /data/local/tmp/...'` 로 감싸면 앱 uid 로 쓰게 돼 `Permission denied` 다 — /data/local/tmp 는 shell uid 만 쓸 수 있다.
그 뒤 `python -c "import sqlite3; ..."` 로 `$dst\voice-alarm.db` 를 열면 `-wal` 이 자동 반영된다.

## 4. 환경 주의 (이 PC)

- **WSAEFAULT(10014)**: 소켓 bind/listen 간헐 실패로 Gradle 데몬·adb 기동 실패 → 성공까지 재시도. adb가 아예 죽으면 라온 보안 드라이버 정지(관리자): `Stop-Service AnySign4PC Launcher, MagicLine4NXSVC, 'RAON K', WizveraPMSvc` + `sc stop KingsNET` `sc stop TNXNET_SVR` → `adb start-server`. 상세=메모리 `reference_winsock_wsaefault_build_workaround`.
- **K2 캐스케이드**: 같은 모듈 멀쩡한 심볼이 무더기 "Unresolved reference" → clean 재빌드로 해결.

## 5. 알람 음성의 **최종 목적지** (2026-08-18 지시 — 5단계의 미결을 이걸로 닫는다)

> **알람 음성파일은 프리셋 + 직접 입력으로 만드는 것만 남는다.**

즉 알람에 실리는 오디오를 만드는 길은 **둘뿐**이다:

| 남는 것 | 무엇 | 언제 만들어지나 |
| --- | --- | --- |
| **프리셋(사전렌더 클립)** | 기본 목소리 무료 테마 + 등록/공유 목소리의 프리셋 | 서버 cron 이 미리 만들고, 앱이 **선다운로드**로 받아 둔다 |
| **직접 입력** | 사용자가 친 문구 | 저장할 때 그 자리에서 합성(월 한도 차감). 같은 글자면 캐시 재사용 |

**없앤다: 라이브 랜덤 생성.** 날씨·운세·사랑 등을 알람 저장/갱신 시점에 서버가 새 문장으로
합성하던 갈래다. 이게 5단계의 대상이고, 지금까지 **관문의 구멍을 전부 덮고 있던 폴백**이다.

⚠ **이 결정이 닫는 미결 두 가지**(그전에는 "제품 판단이 필요하다" 로 남겨 뒀다):
- **가족 알람**: 지금은 수신자의 날씨·사주로 서버가 라이브 문장을 만든다
  (`generateTTS(targetUserId:targetDynamicPromptState:)`). 그 갈래도 없어진다 →
  가족 알람도 **프리셋 아니면 직접 입력**이다. 프리셋으로 갈 경우
  `toRemoteAlarmWriteRequest` 가 `bucketId` 를 싣지 않는 계약 변경이 선행이고,
  날씨 variant 를 **누구 위치로** 고를지도 정해야 한다(보내는 사람 / 받는 사람).
- **옛 라이브 알람**: `voiceRandomPrompt = true` 로 저장된 반복 알람은 갱신자가 사라지면
  매일 같은 문장이 되고, 시각만 바꾸려 열어도 재사용 판정이 어긋나 **영영 못 고친다.**
  → 문구 종류 ↔ 버킷 역매핑(`RandomPromptContext.forBucket` / `randomPromptContextForBucket`)으로
  **테마 클립에 재바인딩하는 마이그레이션을 같이 낸다.**

### 지우면 안 되는 것 (이름이 비슷해 헷갈린다)

- `WeatherVariantRefreshService`(iOS) / `DynamicVoiceRefreshWorker`(안드) — **음성을 만들지 않는다.**
  `GET /tts/prerender-variant` 로 *이미 받아 둔 클립 중 오늘 어느 것을 틀지* 인덱스만 받아 온다.
  지우면 날씨 테마가 매일 같은 클립으로 굳는다.
- `VoiceStudioViewModel.generateTTS` / 안드 `onGenerateTts` **함수 자체** — 직접 입력의
  유일한 생성기다. 랜덤 갈래만 접고 껍데기는 남긴다.
- `voiceRandomPrompt` **필드** — 무료 강등 판정 2곳과 잠금화면 태그 제거가 읽는다.
- `randomPrompt`/`randomContext`(iOS) — 이름만 '랜덤' 이고 실제로는 **문구 종류 상태**다.
  지우면 사전렌더 버킷을 고를 수단이 없어진다.

### 배포 순서 (뒤집으면 사고)

앱 먼저, 백엔드는 **두 스토어 게재 뒤**. 백엔드 400 을 먼저 넣으면 구버전 앱은
"음성 생성에 실패했어요"(다시 시도해도 안 되는데 다시 시도하라는 문구)만 반복한다.
거절은 반드시 `!draftPreviewRequested && body.random === true` **그 자리에서** 낸다 —
앞당기면 iOS 목소리 등록 미리듣기(`playDraftPreview` 가 `random:true`+`draftPreview:true` 를
함께 보낸다)가 400 이 되어 **새 목소리를 아예 등록할 수 없다.**

### 남은 작업 순서

1. ~~**P1 #2**~~ — **끝났다(2026-08-18).** 아래 「P1 #2 — 관문 세 자리」 참조.
2. ~~iOS 편집기 하단 문구 정리~~ — **끝났다(2026-08-18).** 아래 「iOS 저장 사유 문구」 참조.
3. ~~iOS `statusMessage` 유출 차단~~ — **끝났다(2026-08-18).** 같은 절.
4. **5단계 앱 쪽 제거** ← **여기부터.** 위 5절의 결정(프리셋 + 직접 입력만)으로 미결은
   닫혔지만 **파생 결정 하나가 남아 있다**: 가족 알람을 프리셋으로 보내려면
   `toRemoteAlarmWriteRequest` 가 `bucketId` 를 실어야 하고, 날씨 variant 를 **보내는 사람
   위치로 고를지 받는 사람 위치로 고를지** 정해야 한다. 그리고 옛 `voiceRandomPrompt = true`
   행을 테마 클립으로 재바인딩하는 마이그레이션을 **같이** 내야 한다 — 안 내면 그 알람들이
   매일 같은 문장이 되고, 시각만 바꾸려 열어도 영영 못 고친다.
5. 백엔드 정리 — 스토어 게재 후.

조사 원문: `w1uv7w469.output`(5단계 전수 범위 + P1 8건), `w30oi7j1z.output`(편집기 문구·iOS 구조),
`wy88mi9ha.output`(관문이 돌아야 할 자리 전수 + 저장 경로 추적),
`wnfzhawji.output`(사유 문구 7갈래의 안드로이드·iOS 대체 수단 대조).

### iOS 저장 사유 문구 — 값이 사는 자리로 옮겼다 (2026-08-18 완료)

안드로이드가 같은 날 `editorSaveBlockedReason` 을 Boolean 으로 바꾼 것과 같은 정리다.
**조건은 그대로 두고 문구만 없앴다.**

⚠ **그냥 지우면 iOS 가 안드로이드보다 나빠진다.** 안드로이드가 지울 수 있었던 건 값이 사는
자리가 대신 말해 주기 때문이다. 일곱 갈래를 대조해 **여섯은 이미 있었고 하나가 없었다**:

| 갈래 | 말하는 자리(iOS) |
| --- | --- |
| 플랜 잠금 / **사용 불가 목소리** | `unusableVoiceBanner` — **없어서 새로 만들었다** |
| 목소리 미선택 | 목소리 행 "고르기" + '목소리 탭에서 만들기' |
| 녹음 미완료 | `RecordingCard` 자체가 CTA |
| 날씨 테마 지역 없음 / 랜덤 문구 미완 / 빈 직접 입력 | `PromptDetailCard`("아직 정하지 않았어요") |

- **`unusableVoiceBanner` 의 판정이 안드로이드보다 한 갈래 넓다.** 안드로이드는 무료 등급에서
  `visibleVoiceProfiles` 가 클론을 통째로 걸러 내 "목록에 없다" 하나로 두 경우가 다 잡히는데,
  iOS 는 잠금 배지만 달아 목록에 남기므로 `locked` 도 함께 본다.
- 문구는 안드로이드 `editor_voice_deleted_title/_desc` 를 en·ja 까지 그대로 가져왔다.
  ⚠ **"저장된 목소리는 그대로 울린다" 고 말하는 게 핵심이다** — 막히는 건 문구를 바꾸는
  것뿐인데 "쓸 수 없어요" 로만 읽히면 울리지도 않는 줄 안다.
- **생성 실패는 알럿으로 뺐다**(`showSaveFailureAlert`). 예전에는 `saveFlow` 의 실패 갈래가
  조용히 `return` 하고 사유가 `voiceStudio.statusMessage` 에만 남아, 저장이 막힌 이유를
  말하는 한 줄이 그걸 주워 보여 줬다 — 성격이 다른 두 문장이 같은 자리를 번갈아 썼다.

**곁가지로 나온 것 둘**(둘 다 주석이 없는 동작을 광고하고 있었다):

- **문구 화면의 취소가 취소가 아니었다.** `select(_:)` 가 종류를 먼저 쓰고 나서 물어서,
  취소하면 값 없는 종류가 선택된 채 남았다. 사주 시트만 `draftFortune*` 에 **직접 바인딩**
  이었고(바로 아래 직접 입력 알럿에는 "직접 바인딩하지 말 것" 주석이 있는데도), 운세 완성도
  판정이 `select(_:)`(생년월일 하나)와 `saveEnabled`(셋 다)로 **두 벌**이었다. 서버
  `fortune_ready` 는 셋을 본다 — 생년월일만 채우면 **저장은 되는데 울릴 때 안 나온다.**
- **오프라인인데 "불러오는 중" 이라고 말했다.** iOS 에 연결 상태를 보는 수단이 **아예
  없었다**(`NetworkMonitor` 를 그래서 만들었다 — 안드로이드 `rememberIsOnline` 짝).
  사유 문구를 없앤 뒤로는 이 행이 대체 수단이라, 거짓말하면 지운 근거가 무너진다.

### P1 #2 — 관문 세 자리 (2026-08-18 완료)

**무엇이 문제였나.** 사전렌더 클립 관문이 **목소리를 고를 때 한 번만** 돌았다. 그런데
문구 종류마다 버킷 category 가 다르고(`clonePrerenderBucketCategoryFor`) 서버 렌더는
category 단위로 끝나므로, **같은 목소리가 종류에 따라 준비됐을 수도 아닐 수도 있다.**
목소리를 통과시킨 것이 그 뒤 고른 종류까지 보장하지 못했다.

지금은 라이브 랜덤 생성이 이 구멍을 덮고 있어 증상이 안 나온다. 그걸 걷어내면(위 5절)
그대로 **저장이 조용히 막히는 막다른 길**이 된다 — 사유 문구를 없앴으므로 왜 안 되는지
말해 줄 자리도 없다.

**어떻게 고쳤나 — 판정 하나, 부르는 자리 셋.**

| 자리 | Android | iOS |
| --- | --- | --- |
| 판정(유일 출처) | `ClipGate.needsClipPreparation`(`ui/editor/ClipPreparationGate.kt`) | `AlarmEditorSheet.needsClipPreparation` |
| 1. 목소리 선택 | `VoiceAudioCard` 의 `onNeedsClipPreparation` | `selectedProfileID` 의 `onChange` |
| 2. 문구 종류 선택 | `applyRandomPromptSettings` | `applyMessageSettings` |
| 3. 저장 직전 | `saveEditor` | `saveFlow` |

⚠ **판정식을 세 벌로 베끼지 않았다.** 안드로이드는 컴포저블 밖 `ClipPreparationGate.kt` 로
빼서 파일 경계로 못 박았고(덤으로 테스트 가능해졌다), iOS 는 메서드 하나를 셋이 부른다.
CLAUDE.md 「일곱 자리」가 네 번 깨진 이유가 '같은 판정식을 여러 벌 적어 둔 것' 이라,
**같은 함수를 부르는 것**으로 바꿨다. 새 자리가 생기면 그 함수를 부를 것.

**막을 때는 반드시 준비 페이지로 보낸다.** 막기만 하면 빠져나갈 길이 없다.

⚠ **자리(3)의 위치가 중요하다.** 안드로이드는 `hasFreshTtsAudio` 조기 submit **뒤**,
iOS 는 라이브 생성 블록 **안**이다. 그 앞에 두면 **이미 오디오가 붙어 있는 알람의 시각만
고치는 재저장**까지 준비 페이지로 튀긴다 — 생성할 것도 바인딩할 것도 없는데 클립을
기다리게 하는 셈이고, 매니페스트가 잠깐 비면 멀쩡한 알람을 고칠 길이 사라진다.

**같이 잡은 것 — iOS 테마 알람의 관문 우회.** `selectedProfileID` 의 `onChange` 는 관문을
지난 **뒤** 테마 알람의 `randomPrompt` 를 되켠다(`wasThemeAlarm` 분기). 관문은 그 전 값
(false)으로 물어봐서 "랜덤이 아니니 클립이 필요 없다" 며 통과시켰고, 곧바로 랜덤이 켜져
클립이 필요한 상태로 바뀌었다 — **테마 알람의 목소리를 아직 못 받은 클론으로 바꾸는
흐름이 통째로 관문을 빠져나갔다.** 이제 `wasThemeAlarm` 을 먼저 구해 **바뀔 값**으로
판정한다. 안드로이드에는 목소리 변경 시 `voiceRandomPrompt` 를 켜는 자리가 없어(grep 확인)
같은 구멍이 없다.

**회귀 테스트**: `ClipPreparationGateTest`(7개). 지키는 것은 **"한 목소리가 종류에 따라
준비됐을 수도 아닐 수도 있다"** 는 사실 하나 — 그게 맞아야 자리(2)(3)이 필요하다.
