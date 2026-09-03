# Dev 테스트 핸드오프 (갱신 2026-09-02)

> 세션 재개용 라이브 문서. 상태가 바뀌면 이 파일을 갱신/정리한다. (다른 컴퓨터에서도 `git pull` 후 이 문서만 읽으면 이어서 진행 가능.)
> 끝난 검증은 여기 남기지 않는다 — 남은 것과 다음에 또 쓸 방법만 둔다.

## 0-A. 스톡 클립 — 대사 확정, **시딩만 남았다**

2026-09-02 에 **세 언어 대사가 모두 확정**됐다(사용자 확정본). 한국어를 복사해 두었던
임시 문구는 사라졌다.
같은 날 '사랑'(`love`)을 **'응원'(`cheer`)** 으로 바꿨다 — 연애 문구가 아니라 응원·자기돌봄이다.

마이그레이션 **#110** 이 시스템 스톡 프리셋을 **전부 지우고** 카테고리 이름을 옮긴다.
그래서 배포 직후에는 기본 목소리에 클립이 하나도 없고, **시딩해야 목록이 돌아온다.**

- [ ] dev 배포 확인 → `POST /api/admin/seed-stock-clips?max=12` 를 `remaining` 이 0 될
      때까지 반복(보이스 4 × 언어 3 × 문구 20 = **240개**). 헤더 `x-init-db-secret`.
- [ ] 실기기: 기본 목소리 편집기에서 문구 목록이 **날씨·운세·응원·약 + 직접 입력** 인지.
      시딩이 도는 중에는 **완전한 세트만** 보이므로 카테고리가 하나씩 나타난다(정상).
- [ ] 운세를 고르면 사주를 묻는지(없으면 저장이 막힌다).
- [ ] 비행기모드 발사 — 선다운로드가 네 카테고리를 다 받았는지.
- [ ] 클론(유료) 목소리: #110 이 큐를 되돌렸으므로 cron 이 응원 클립을 다시 굽는다.
      21클립이 다시 차는지.

⚠⚠ **prod 배포 순서 — 이건 코드로 못 막는다.**
`#111` 은 프로필 id 를 그대로 두고 목소리만 바꾼다. 그런데 앱은 그 id 에 **내장 인사말
mp3** 를 매핑해 두고 미리듣기에서 서버 클립보다 **우선**한다. 그래서 구버전 APK 가 깔린
채로 이게 배포되면 **미리듣기는 옛 목소리, 실제 알람은 새 목소리**가 되어 들어 보고 고른
것과 다른 소리가 울린다.
- [ ] 새 목소리를 담은 앱을 **스토어에 먼저** 올린다.
- [ ] `app-version.ts` 의 `minSupported` 를 그 versionCode 로 올린다.
- [ ] 그 뒤에 이 마이그레이션을 prod(`main`)에 낸다.
(dev 는 테스트 기기 APK 를 함께 갈아 끼우면 되므로 무관하다.)

⚠ **기본 목소리 4종도 함께 교체됐다**(#111, 2026-09-03): 시우 · 미나 · 도현 · 애니.
교체 전에는 넷 중 둘이 영어권 premade 목소리였다(`아담`=Adam, `소은`=Jessica). 내장
미리듣기 mp3 12개(`res/raw/voice_greeting_*`)도 새 목소리로 다시 구웠다.

로컬 미리듣기: `voice-preview/<이름>/` 에 목소리별 한국어 20개가 생성돼 있다(프로덕션과
같은 파라미터 + 문장 끝 여운). 실제 시딩 오디오와 같은 소리다.

## 0. 진행 중 — 클립 선다운로드 후속

클립 선다운로드 1~5단계는 양 앱과 백엔드에서 모두 완료됐다. 라이브 랜덤 생성은
`3929214c`에서 제거되어 알람 음성을 **사전렌더 프리셋 + 직접 입력** 두 경로로만 만든다.
현재 규약과 구현 지도는 [`docs/spec/voice-and-message.md`](../spec/voice-and-message.md)를 본다.

지금 남은 것은 **iOS 백그라운드 진행 표시 연결 하나**다. Android는 WorkManager 진행률
알림이 동작한다. iOS는 `Shared/ClipPrefetchActivityAttributes.swift`와
`AlarmTalkWidget/ClipPrefetchLiveActivity.swift`가 번들에 등록돼 있지만
`StockClipPrefetcher`가 아직 Live Activity를 시작·갱신·종료하지 않는다.

Swift 6에서 `Activity`가 `Sendable`이 아니어서 `update/end` 전달 시 데이터 레이스 진단이
발생한다. 기존에 `@MainActor`, `Task { @MainActor in }`, 제네릭 명시를 시도했으나 같은
지점에서 막혔다. 다시 작업할 때는 Activity 조작을 소유하는 별도 경계에서 해결하되,
`@unchecked Sendable`로 경고만 숨기지 말고 실제 실행 순서를 직렬화한다.

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

### ⑤-2 목소리 교체 — 직접 입력 알람 강등 (유료 계정 필요, 되돌릴 수 없음)
규약: [`docs/spec/voice-and-message.md`](../spec/voice-and-message.md) 「제자리 교체」.
- [ ] 클론 목소리로 **직접 입력** 알람 1개 + **프리셋(테마)** 알람 1개를 만든다.
- [ ] 새 목소리를 등록하며 '교체' 체크 → 저장. **그 기기에서 바로**: 직접 입력 알람이 기본
      알람음이 되고(목록 배지), 프리셋 알람은 그대로 남는다(잠시 뒤 새 목소리로 재렌더된다).
- [ ] 같은 계정의 **다른 기기**: 푸시(`voice_access_revoked` + `voiceProfileId`) 수신 후 같은
      결과가 되고, 앱을 열면 "새 목소리로 바뀌었어요" 모달이 **한 번** 뜬다.
- [ ] 그 뒤 프리셋 알람을 발사 → **새 목소리**로 울린다(옛 목소리가 아니다). 재렌더가 끝난 뒤에
      확인할 것(21클립, 틱당 6개라 ~20분).
- [ ] 같은 달에 **한 번 더 교체**하려 하면 `목소리는 한 달에 1번만 변경할 수 있습니다` 로 막힌다
      (예전에는 교체가 월 한도를 그냥 지나갔다).

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
- ⚠ **iOS 실기기 테스트는 예전에 그 폰의 로그인·알람·목소리를 지웠다**(2026-08-19 원인 규명·수정).
  유닛 테스트가 **호스트 앱 프로세스**에서 돌아 기본 저장 위치가 사용자의 것과 같았다 —
  `AuthViewModelTests` 가 진짜 `signOut()` 을 불러 키체인 세션을 지웠고, `AlarmAppContextTests`
  의 `setUp` 이 알람 JSON 을 `removeItem` 했고, 그 바람에 스톡 클립도 함께 날아가 **다음
  로그인이 기본 목소리를 전부 다시 받았다**("로그인마다 다시 받는다" 제보의 정체).
  앱 데이터 컨테이너는 멀쩡했으므로(며칠 전 파일이 그대로 있었다) **재설치 탓이 아니다.**
  이제 `AlarmTalk/TestIsolation.swift` 가 저장 위치를 한 곳에서 가르고, 우회는
  `scripts/check-test-isolation.py`(CI lint)가 막는다. 회귀 테스트 `TestIsolationTests`.
  검증 방법: 진짜 경로에 센티넬을 심고 전체 스위트를 돌린 뒤 그대로인지 본다
  (`devicectl device copy to --domain-type appDataContainer ... --user mobile`).

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
4. **5단계 앱 쪽 제거** ← **여기부터.** 착수 전 아래 「5단계 착수 전 실측」을 반드시 읽을 것.
   파생 결정은 **닫혔다(2026-08-18 지시)**:
   가족 알람의 날씨 variant 는 **받는 사람 위치**로 고른다 —
   규칙 전문은 [`docs/spec/family-alarm.md`](../spec/family-alarm.md) 4절.
   남은 일은 (a) `toRemoteAlarmWriteRequest` 에 `bucketId` 싣기, (b) 옛
   `voiceRandomPrompt = true` 행을 테마 클립으로 재바인딩하는 마이그레이션 — 안 내면 그
   알람들이 매일 같은 문장이 되고 시각만 바꾸려 열어도 영영 못 고친다, (c) 양 앱의 라이브
   생성 경로 제거.
5. 백엔드 정리 — 스토어 게재 후.

조사 원문: `w1uv7w469.output`(5단계 전수 범위 + P1 8건), `w30oi7j1z.output`(편집기 문구·iOS 구조),
`wy88mi9ha.output`(관문이 돌아야 할 자리 전수 + 저장 경로 추적),
`wnfzhawji.output`(사유 문구 7갈래의 안드로이드·iOS 대체 수단 대조).

### 5단계 착수 전 실측 (2026-08-18, `w9noiym6f.output`)

전수 조사에서 **착수 전에 알아야 계획이 바뀌는 것 넷**이 나왔다. 전부 직접 코드로 확인했다.

**① 가족 알람은 지금 테마를 실을 수 **없다** — 다리가 세 군데 끊겨 있다.**
`bucket_id` 는 와이어 타입에도(`RemoteAlarmWriteRequest` 양 앱), 백엔드 검증에도
(`alarm-helpers.ts` 의 `INVALID_BUCKET_ID` 화이트리스트), 쓰기·읽기 SQL 에도(`SELECT a.*`)
이미 있다. 그런데:
- **보내는 쪽이 안 싣는다.** 안드로이드는 `AlarmDraft.toRemoteAlarmWriteRequest`
  (`MainViewModelAlarmActions.kt`)가 11개 필드만 넣고 `bucketId` 를 뺀다. iOS
  `createFamilyTargetAlarm` 도 같다. **와이어 타입의 기본값이 `null` 이라 컴파일 에러가 안 난다.**
- ⚠ **빌더가 두 벌인 게 원인이다.** 자기 알람용 `RemoteAlarmMapper.toWriteRequest` 는
  `bucketId = alarm.bucketId.trimmedOrNull()` 를 **보낸다.** 필드가 한쪽에만 추가되고 다른
  쪽에 안 따라간 것 — CLAUDE.md 「한 곳에서만」이 말하는 그 사고다. 고칠 때 **둘을 합치거나
  최소한 어긋나면 깨지는 테스트**를 같이 둘 것.
- **받는 쪽은 플랫폼마다 달랐다.** 안드로이드 `buildReceivedAlarmRow` 는 **이미 옮기고
  있었다**(`bucketId = remote.bucketId?.trim()?.takeIf { hasVoiceAudio && … }`). iOS 는
  달랐다 — 읽기 모델 `RemoteAlarm` 에 `bucketId` **필드 자체가 없었고**,
  `LocalAlarmRecord` 의 **명시적 init** 에도 없어서(멤버와이즈가 아니다) 생성 시 넣을 수가
  없었다. 그래서 iOS 는 이 값을 '로컬 전용' 으로 다뤄 왔고, pull 병합이 무조건
  `existing.bucketId` 로 덮었다 — **받은 알람은 로컬 값이 생길 일이 없으니 영원히 nil.**

**→ 셋 다 고쳤다(2026-08-18).** 보내는 쪽 양 앱 + iOS 읽기 모델·매퍼·병합.
회귀 테스트 `FamilyAlarmWriteRequestParityTest` 는 두 빌더의 결과를 **통째로 비교**한다
(data class `equals` 라 **앞으로 생길 필드까지** 자동으로 대상이다). 의도된 차이 둘
(`isActive`·`targetUserId`)만 눌러 두고 비교하므로, 한쪽에만 필드를 넣으면 그 순간 깨진다.
⚠ **아직 실기기 2대 검증은 안 했다** — 스펙의 「검증 방법」대로 확인할 것.

**② ~~Room 의 `fallbackToDestructiveMigration()`~~ — 걷어냈다(2026-08-18).**
붙어 있던 근거가 "개발 중이라 보존할 데이터 없음" 이었는데 그건 이제 사실이 아니다 — 앱은
스토어에 있고 베타 테스터의 알람이 들어 있다. 켜져 있으면 마이그레이션을 빠뜨린 채
`version` 만 올렸을 때 **알람이 조용히 전부 삭제**된다(예외도 로그도 없다). 지금은 없는 게
안전하다: 1→24 가 빠짐없이 등록돼 있고, 앞으로 빠뜨리면 **앱이 켜자마자 죽는다** — 죽는 건
즉시 눈에 띄어 고칠 수 있지만 지워진 알람은 되돌릴 수 없다.
회귀 방지 `AlarmDatabaseMigrationSafetyTest` 가 **소스를 읽어** 둘을 지킨다: 플래그가 없을 것,
그리고 `version = N` 이면 `MIGRATION_1_2`…`MIGRATION_(N-1)_N` 이 **전부 `addMigrations` 에
넘어가 있을 것**(정의만 하고 안 넘기면 무효라 그것도 잡는다).
23→24 는 받은 알람의 적용 완료 전달 버전(`remoteDeliveryVersion`)을 영속하기 위해 추가했고,
같은 회귀 테스트가 등록 누락을 막는다.

**③ ~~iOS 의 두 번째 라이브 생성 경로~~ — 걷어냈다(2026-08-18, 아래 (c)).**
`DynamicVoiceRefreshService` 가 반복 랜덤 알람을 **매일 밤 다시 합성**한다(포그라운드 진입 +
`BGAppRefreshTask` 양쪽). 안드로이드의 `DynamicVoiceRefreshWorker` 는 날씨 variant 인덱스만
resolve 한다 — **합성하지 않는다.** 즉 제거 작업이 두 앱에서 비대칭이다.
남길 것과 섞지 말 것: `WeatherVariantRefreshService`(variant 재선택, 합성 아님)와
`AlarmScheduleReconciler`(행↔OS 예약 정합)는 프리셋 경로에서도 필요하다.

**④ 옛 행 재바인딩은 Room 마이그레이션으로 못 한다.** 마이그레이션은 `bucketId` 를
`voiceRandomContext` 에서 채우는 오프라인 절반만 할 수 있고, `bucketClipKeysJson` 이 가리키는
클립 파일은 **받아야 생긴다.** 제자리는 `sync/StockClipLanguageRebinder.kt` 다 — 이미
네트워크를 쓰고 멱등이며 매니페스트 수신 뒤 `StockClipPrefetchWorker` 의 **모든 성공 경로**
에서 불린다. 술어만 넓히면 된다. 매핑은 `clonePrerenderBucketCategoryFor` 를 **그대로 재사용**
할 것(다시 적지 말 것).
→ **그대로 했다(2026-08-18, 아래 (b)).**

### 5단계 (b)(c) 완료 (2026-08-18)

**순서를 지켰다 — (b) 재바인딩이 (c) 제거보다 먼저 나가야 한다.** 뒤집으면 옛 알람이
옮겨지기 전에 생성 경로가 사라져, 그 사이 **마지막에 만들어진 한 문장만 매일 반복**한다.

**(b) 옛 행 재바인딩** — `voiceRandomPrompt = true` 이고 `bucketId` 가 빈 행을 문구 종류에
맞는 테마 클립으로 옮긴다. 랜덤 플래그는 내리고 **종류는 남긴다**(편집기가 열 때 되짚는 값).
묶을 클립이 없으면 **아무 일도 하지 않는다** — 지우면 소리가 사라지고, 옛 문장이라도 울리는
편이 낫다. 멱등이라 매 회차 돌아도 안전하다.
곁들여: 클립 바인딩 루프를 두 재바인더가 **공유**하도록 끌어냈고, iOS 루프에 없던
**variant 정렬·중복 제거**를 넣었다(날씨·운세는 절대 인덱스라 순서가 곧 뜻이다).

**(c) 라이브 랜덤 생성 제거**
- 편집기(양 앱): 문구 종류를 골랐으면 **반드시** 사전렌더 클립으로 묶고, 못 묶으면
  **준비 페이지로 보낸다.** 라이브 폴백은 없앴다.
- 안드로이드 `/tts/generate` 요청은 이제 `random = false, randomContext = null` 고정이고
  `alarmHour`·`weather*`·`fortune*` 를 **보내지 않는다.** ⚠ 그 값들은 **행에는 그대로 남는다**
  — 사전렌더 variant 를 고르는 데 쓰인다.
- 안드로이드 버킷 바인딩의 제외 갈래 둘(`!familyAlarmMode`, `!isSystemVoiceId`)을 없앴다.
  가족 알람은 이제 `bucket_id` 를 실어 보내므로(위 ①) 수신자 무음 문제가 사라졌다.
- iOS `DynamicVoiceRefreshService` **삭제**(+ `BackgroundSyncTask`·`AlarmTalkApp` 주입, 테스트).
  `refreshDynamicVoicesIfNeeded` → `refreshWeatherVariantsAndReconcile` 로 이름을 고쳤다 —
  없는 기능을 광고하는 이름이었다.
- **남긴 것**: 직접 입력 합성(월 한도 차감), `WeatherVariantRefreshService`(합성이 아니라
  variant 재선택), `AlarmScheduleReconciler`, `generateTTS` 함수 자체, `voiceRandomPrompt`
  필드, iOS `playDraftPreview`(목소리 등록 미리듣기 — `random:true` + `draftPreview:true` 를
  같이 보내므로 걷어내면 **새 목소리 등록이 통째로 막힌다**).

### dev 백엔드 배포 완료 (2026-08-18)

`npm run deploy:dev` 로 `feat/ios-revive` 의 백엔드를 dev 에 올렸다(Version `d68337dd`).
마이그레이션은 101개 전부 **이미 적용돼 있었다** — 스키마 변경 없이 워커 코드만 새로 올라갔다.

⚠ **배포 범위가 `expected_variants` 만이 아니다.** 이 브랜치에는 애플 IAP 마이그레이션
94~96(`users.apple_id`, `subscriptions.apple_*`, `push_tokens`/`store_transactions` 테이블
재생성)도 들어 있다. 재생성은 `INSERT INTO … SELECT` 로 **데이터를 옮기는** 방식이라 행이
사라지지 않는다. dev 에는 이미 적용돼 있었다.

**확인**: 기기가 받은 매니페스트에 `expected_variants` 가 들어온다 —
`clone {greeting:1, weather:9, fortune:5, love:3, medication:3}` /
`system {weather:9, medication:2, greeting:1}`. 코드 주석이 말하던 "medication 은 시스템 2 /
클론 3" 이 실제로 그렇다. **앞서 지목한 원인(`ae0e4e7a` 미배포)이 맞았다.**

⚠ **클론 클립은 아직 0개다.** `expected_variants` 는 왔지만 사전렌더 cron(`*/5 * * * *`)이
ElevenLabs 를 불러 실제 클립을 만들어야 한다. 그게 도착해야 **클론 + 테마 저장 경로**와
**클론 옛 행 재바인딩**을 검증할 수 있다.

### iOS 알람 삭제 — 남은 갈래 (2026-08-18)

**실기기 설치 완료(2026-08-18 17:58)** — `이스트의 iPhone (3)`(iPhone 14 Pro).
유료 개발자 계정으로 서명이 통과했다. 사용자 확인 대기 중.

⚠ **팀 ID 는 `29N7GX354N` 이다.** 인증서 CN 의 괄호값(`8B3CPZ9Q87`)은 **사용자 ID 지
팀 ID 가 아니다** — 그걸로 `DEVELOPMENT_TEAM` 을 주면 `No Account for Team` 으로 죽는다.
팀 ID 는 인증서 subject 의 `OU=` 이고, `defaults read com.apple.dt.Xcode` 의
`IDEProvisioningTeamByIdentifier` 로도 확인된다(`isFreeProvisioningTeam = 0`).

    xcodebuild -project AlarmTalkNative.xcodeproj -scheme AlarmTalk \
      -destination 'id=<기기 UDID>' -allowProvisioningUpdates \
      DEVELOPMENT_TEAM=29N7GX354N -derivedDataPath /tmp/att-dev build
    xcrun devicectl device install app --device <기기 UDID> \
      /tmp/att-dev/Build/Products/Debug-iphoneos/AlarmTalk.app

⚠ 기기 바이너리에는 `nm` 으로 Swift 내부 심볼이 안 보인다 — 그걸로 "옛 빌드다" 라고
판단하지 말 것. 빌드 시각과 워킹트리 상태로 확인한다.

**고친 것**: `AlarmManager.cancel(id:)` 은 AlarmKit 이 그 id 를 **모를 때 throw** 한다.
예전 코드는 그때 로컬 행을 남겨 **영영 지울 수 없는 알람**이 됐다(`8b4be497`).
지금은 AlarmKit 이 정말 안 들고 있을 때만 지운다. 판정은 **`AlarmManager.alarms`(권위)** 로
하고, 못 물어볼 때만 `lastAlarmStateSnapshot` 캐시로 폴백한다 — 캐시는 emit 때만 갱신돼
울리고 해제된 직후 창에서 "아직 예약돼 있다" 고 잘못 답한다.

**⚠ 아직 안 고친 두 번째 갈래 — 받은(가족) 알람의 부활.**
iOS 로컬 스토어에는 **툼스톤이 없다**(`LocalAlarmStore.delete` 는 하드 삭제).
받은 알람을 지울 때 `deleteRemote` 가 **decline 에 실패하면**(네트워크 등) 로컬에서만
사라지고 **다음 pull 이 그대로 다시 가져온다** — 사용자 눈에는 "지워도 다시 생긴다" 다.
증상이 겹칠 수 있어 확인했는데, **2026-08-18 보고건은 이 갈래가 아니다** — 사용자가 직접
만든 알람이었다(`local_owned` 는 `DELETE /alarm/:id` 로 서버에서도 지워지고,
`isReceivedRemoteCandidate` 가 `target_user_id` 를 요구하므로 pull 이 되살릴 수 없다).
그래도 **받은 알람에는 이 구멍이 그대로 남아 있다** — 별건으로 툼스톤을 넣어야 한다.
(조사 원문 `w0vkdrwrt.output` 의 `mergeRemote` 항목 — 검증자 평가 medium.)

### 삭제 낙관적 업데이트 — 다음에 할 것 (2026-08-18 요청)

사용자 보고: **양 앱 모두 삭제를 눌러도 바로 안 사라지고 조금 뒤에 적용된다.**

**원인**
- iOS `AlarmsListView.deleteAlarm` 은 `remoteSync.deleteRemote` 를 **먼저 await** 하고,
  그 성공 경로가 다시 `refresh(session:)` 으로 **pull 한 바퀴**(목록 + TTS 음원)를 돈다.
  로컬 행은 그게 다 끝난 뒤에야 사라진다 — 체감 지연의 본체다.
- 안드로이드는 내 알람이면 곧장 `repository.deleteAlarm` 이지만, 그게
  `restoreMutex.withLock` 이라 복구·동기화가 락을 잡고 있으면 그만큼 밀린다.

⚠ **받은(가족) 알람은 낙관적으로 바꾸면 안 된다.** iOS 스토어에 **툼스톤이 없어서**
(`LocalAlarmStore.delete` 는 하드 삭제) decline 없이 지우면 **다음 pull 이 되살린다.**
안드로이드 `deleteAlarm` 이 decline 실패 시 로컬 삭제까지 보류하는 게 바로 그 이유이고,
주석에 근거가 적혀 있다. "조금 늦게 사라짐" 보다 "지웠는데 다시 생김" 이 훨씬 나쁘다.

**진행 상황(2026-08-18)**
- ✅ **1·2번 완료.** iOS `deleteRemote` 가 성공 뒤 돌던 **전체 `refresh()` 를 걷어냈고**
  (알람 하나 지우자고 목록 + TTS 음원을 다시 받고 있었다 — 체감 지연의 본체),
  결과를 `Bool` 로 돌려주게 해 갈래를 나눌 수 있게 했다. **내 알람은 로컬을 먼저 지우고
  서버 삭제를 뒤로** 보낸다.
- ⚠ **안드로이드는 고칠 게 없었다(가설이 틀렸다).** 내 알람 경로는 이미 로컬 전용이고
  (`repository.deleteAlarm` = 예약 취소 + Room 삭제 + 캐시 정리), 의심했던 `restoreMutex` 도
  pull 이 **DB 작업 동안만 짧게** 잡는다 — `fetchRemoteMessageAudio` 는 락 **밖**이다
  (`RemoteAlarmPullSyncService` 의 `alarmMutationLock.withLock` 블록 3개 모두 DB 전용).
  안드로이드가 느리게 느껴졌다면 원인이 다른 데 있다 — **실기기 측정이 먼저**다.

**할 일 (순서)**
1. iOS `deleteRemote` 가 **성공/실패를 반환**하게 고친다(지금은 `async -> Void` 라
   statusMessage 로만 알린다 — 갈래를 나눌 수가 없다).
2. **내가 만든 알람만** 낙관적으로: 로컬·AlarmKit 취소를 먼저 하고 서버 삭제는 뒤에서.
   pull 이 되살릴 수 없으므로(`isReceivedRemoteCandidate` 가 `target_user_id` 를 요구)
   안전하다. 실패하면 서버에 고아 행이 남는 것뿐이라 재시도로 정리한다.
3. iOS 삭제 성공 뒤의 **전체 `refresh()` 를 걷어낸다** — 알람 하나 지우자고 목록과 음원을
   다시 받을 이유가 없다.
4. 받은 알람 툼스톤은 **별건**으로 남긴다(그게 있어야 받은 알람도 낙관적으로 갈 수 있다).

### 테마 토글 감사 — 고친 것과 **두기로 한 것** (2026-08-18)

**고쳤다**
- `IosAlertDialog` — 컨테이너만 고정 다크라 라이트에서 제목이 안 보였다. 컨테이너·버튼
  채움만 스킴별로 가르고(다크는 실측값 유지), 판정은 새로 노출한 `LocalIsDarkTheme` 로 한다.
  ⚠ `isSystemInDarkTheme()` 을 직접 보지 말 것 — 앱 자체 `ThemeMode` 를 놓친다. 실제로
  테스트폰이 시스템 다크인데 앱이 Light 라 **시스템 토글만으로는 재현조차 안 됐다.**

**확인했고 두기로 했다(2026-08-18 지시 "그건 괜찮을거같아")** — 다시 올리지 말 것:
- `WakerBackButton` 의 `WakerBackCircleFill/Stroke` (생 색, 라이트 대비 ≈1.01:1)
- `AlarmTalkSwitch` 의 `Color.White` 손잡이 (라이트 OFF 에서 `surfaceVariant` 와 근접)

둘 다 "고정색 + 테마색 혼용" 으로 알럿과 같은 패턴이고 감사에서 real-defect 로 검증됐지만,
**제품 판단으로 두기로 했다.** 나중에 화면에서 실제로 거슬리면 그때 고친다.
조사 원문: `wrfo7ista.output`.

### QA 전용 dev 계정 3개 (2026-08-18 생성)

구글 로그인은 재설치 뒤 계정 선택을 자동화하기 어려워, **이메일·비밀번호 계정**을 만들어 뒀다.
지우고 새로 깔아도 이걸로 다시 들어갈 수 있다.

| 이메일 | user id | 플랜 |
| --- | --- | --- |
| `qa.tester1@alarmtalk.dev` | `66840fd2-51c4-475f-955c-9d8221f0ed6f` | free |
| `qa.tester2@alarmtalk.dev` | `0a8db71e-076f-4de7-ab05-930de4be836f` | free |
| `qa.tester3@alarmtalk.dev` | `e459c2a4-3f45-4c95-ba17-003550b28b7e` | free |

비밀번호 셋 다 `QaTest!2026aa`.

**어떻게 만들었나** — 메일을 받을 수 없으므로 `email_verification_codes` 의 `code_hash` 를
내가 아는 코드(`424242`)의 해시로 바꾼 뒤 **진짜 `/auth/register` 를 태웠다.**
해시는 `SHA-256(정규화이메일:코드:PASSWORD_PEPPER)`.
스크립트: `<scratchpad>/mkacct.mjs`, 질의 헬퍼: `<scratchpad>/dq.mjs`
(둘 다 `.dev.vars.dev` 의 `TURSO_*`·`PASSWORD_PEPPER` 를 env 로 받는다).

⚠ **users 행을 손으로 INSERT 하지 말 것.** `family_alarm_quiet_windows` 컬럼 DEFAULT 가
`평일 09:00–18:30` 이라, 명시하지 않으면 그 시간대에 가족 알람이 **조용히 막힌다**
(docs/spec/family-alarm.md 2절). 위 셋은 진짜 가입 플로우를 타서 `[]` 로 들어갔다 — 확인함.

⚠ `.dev.vars.dev` 는 **줄 단위로 못 읽는다**(PEM 등 여러 줄 값이 섞여 있어 `source` 가 깨진다).
필요한 변수만 `grep -m1 '^NAME=' | cut -d= -f2-` 로 뽑아 쓸 것.

### 다음 세션 QA 계획 (2026-08-18 지시)

**필요한 것은 다 있다** — 두 폰 연결됨(`R3CW300EZBA` S23 Ultra / `RF9R40323AP` A32),
`packages/backend/.dev.vars.dev` 에 `TURSO_DATABASE_URL`·`TURSO_AUTH_TOKEN`(dev DB 직접 수정
가능)과 `INIT_DB_SECRET`, wrangler 인증됨.

알려진 계정 id: S23 `3c059777-086f-4653-826e-bbbc92f85afd` /
`9671a7ae-d272-4091-872c-b123754191e4`, A32 는 구글 id `101930194963020851904`
(AlarmTalk user id 는 DB 에서 이메일로 찾을 것).

**순서**
1. **셋 다 무료로 내린다**(dev DB `users.plan` 수정) → 무료에서 되는 것/막히는 것 전수 점검:
   설정·알람 수정·목소리 선택·문구(테마) 선택·이용권 게이트 3상태.
2. **지우고 새로 깔아 본다**(사용자 승인함) — 목적은 **음성 다운로드 확인**(선다운로드가
   처음부터 도는지, 오프라인 콜드스타트에서 매니페스트 디스크 캐시가 먹는지).
   ⚠ **로그인 복구 경로를 먼저 확인할 것** — 구글 계정 선택이 자동화 가능한지 보고 지울 것.
   못 돌아오면 그 폰으로 더는 테스트할 수 없다.
3. **유료로 올려 초대·가족 알람**(dev DB 수정) — 서로 보내고 받기 양방향.
   여기서 비로소 앞 세션에 막혔던 ① 가족 알람 테마(`bucket_id` 왕복 +
   `messageBelongsToCaller` 3갈래)를 검증할 수 있다.

⚠ **앞 세션에서 확인된 제약**: 편집기에 **수신자 행이 아예 안 뜬다** — 가족 알람은 커플/가족
이용권이 있어야 열린다. 그래서 3번이 1·2번 뒤에 온다.

### 실기기 검증 결과 (2026-08-18, S23 Ultra `R3CW300EZBA` + A32 `RF9R40323AP`)

**② 옛 행 재바인딩 — 통과.** 폰에 옛 행이 하나도 없어서(4행/2행 모두 `voiceRandomPrompt=0`)
**만들어서** 검증했다: 시스템 목소리 행을 `voiceRandomPrompt=1` + `bucketId=NULL` +
클립키 없음으로 되돌린 뒤 앱 실행. `StockClipPrefetchWorker` SUCCESS 직후

    rp 1→0 · bucketId (null)→greeting · 클립 1개 바인딩 · ctx 'preset' **그대로**

`ctx` 가 남는 것이 핵심이다(편집기가 열 때 되짚는 값). 매핑도 맞다 — `preset`→`greeting`.
클립 1개는 정상이다: 매니페스트에서 greeting/ko 는 **목소리당 1개**다(4개는 시스템 목소리
4종의 합).

**③ 못 묶는 행은 그대로 둔다 — 통과.** 같은 회차에 클론 목소리(`e33f6fe0`) 행도 옛 행으로
만들어 뒀는데, 매니페스트에 그 목소리 클립이 **하나도 없어** 손대지 않고 넘어갔다
(`rp=1`, `bucketId` 없음, 옛 음원 유지). 설계한 대로다 — 지웠으면 소리가 사라진다.

**① 가족 알람 테마 — 검증 못 했다. 이유가 둘이고 둘째가 중요하다.**

  1. 테스트 계정에 가족 알람 수단이 없다(편집기에 수신자 행이 안 뜬다).
  2. ⚠ **dev 백엔드에 필요한 커밋이 안 올라가 있다.** 기기에서 받은 매니페스트가
     `expected_variants: null` 이고 **클론 클립이 0개**다. 그 값을 내려주는
     `routes/tts.ts` 의 `expectedVariantCounts()` 는 커밋 `ae0e4e7a`
     (「클론도 사전렌더를 쓴다 + 세트 크기를 서버가 정한다」)에 들어 있는데, 그 커밋은
     **`feat/ios-revive` 에만 있고 `develop` 에는 없다.**

⚠ **그래서 5단계는 백엔드 배포와 짝이다.** (c) 로 테마 바인딩이 **필수**가 됐는데, 지금
dev 백엔드에는 클론 사전렌더 클립이 존재하지 않는다 → 클론 + 테마 알람은 **영원히 준비
페이지로 튕긴다.** 순서는 **`ae0e4e7a` 가 든 백엔드를 dev 에 먼저 배포**한 뒤 앱을 올리는
것이다. 배포 전에는 ①을 테스트할 수 없다.

**아직 못 한 것**: 편집기에서 테마 알람을 **새로 저장**하는 경로(저장 탭이 안 먹혀 행이
안 생겼다 — 좌표 문제로 보인다). 재바인딩 경로는 위처럼 확인됐다.

**검증 뒤 폰 상태는 원래대로 되돌렸다**(4행 전부 원값, A32 예약 `pending=1 scheduled=1`).

⚠ **백엔드 정리(5번)는 여전히 스토어 게재 후다.**

⚠ **백엔드 정리(5번)는 여전히 스토어 게재 후다.** 거부 판정은 정확히
`!draftPreviewRequested && body.random === true` 자리여야 한다 — 앞당기면 iOS 목소리 등록이
깨진다.

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
