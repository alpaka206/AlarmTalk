# 2026-10-18 Sentry 후속 확인

한국 시간 2026-10-16 00:00 이후에 관측된 이슈를 전체 프로젝트·전체 환경에서 조회했다
(`lastSeen:>=2026-10-15T15:00:00Z`, 14일 창). 7개 이슈가 있었으며, 같은 실패의 앱·서버 보고는 함께 본다.
조회에는 기존 Chrome의 Sentry 로그인 세션을 사용했다. 이 문서는 조회 시점의 기록이며 현재 할 일은
[`dev-test-handoff.md`](dev-test-handoff.md)를 따른다.

| 이슈 | 확인한 근거 | 처리 |
| --- | --- | --- |
| [ANDROID-1J](https://alarmtalk.sentry.io/issues/7795551877/) · [BACKEND-E](https://alarmtalk.sentry.io/issues/7759150754/) | 10/16 05:40:50 UTC, Android 1.2.14(34)의 탈퇴 요청 500과 같은 시각 서버 `/api/user/me/deletion`의 Turso 520. Infinix X6532C, 화면 720×1520·360dpi로 사전 출시 화면 조건에 해당하지 않음 | 탈퇴 쓰기 트랜잭션을 COMMIT 전 실패·롤백 성공/트랜잭션 닫힘일 때만 제한 재시도. COMMIT 응답 유실과 롤백 실패는 재시도하지 않음 |
| [ANDROID-1K](https://alarmtalk.sentry.io/issues/7798432041/) | 1.2.13(33), HRY-LX1T, 화면 짧은 변 288px·106dpi. 탈퇴 상태의 음원 다운로드 403 | 구버전 로봇 실행. 현 코드에는 탈퇴 상태 처리와 이 오류의 경보 제외가 있으며, #913 화면 기반 `prelaunch` 분류도 다음 앱에 포함됨 |
| [ANDROID-D](https://alarmtalk.sentry.io/issues/7731194901/) | 최신 이벤트도 1.2.13(33), HRY-LX1T, 288px·106dpi. Google Billing `ProxyBillingActivity`의 null PendingIntent | 구버전 로봇의 SDK 화면 실행. 이 관측만으로 실제 구매 경로 결함이나 SDK 업데이트 필요성을 단정하지 않음. 실기기 결제 검증은 별도 |
| [ANDROID-1G](https://alarmtalk.sentry.io/issues/7793786796/) | 최신 이벤트는 1.2.13(33), HRY-LX1T, 288px·106dpi, Google 로그인 상태 코드 8 | 로봇 환경으로 분류. 코드 8을 사용자 취소로 숨기지 않음(#912의 취소 코드 16과 다름) |
| [ANDROID-1H](https://alarmtalk.sentry.io/issues/7795269376/) · [BACKEND-K](https://alarmtalk.sentry.io/issues/7795269418/) | 10/16 01:04~01:06 UTC 문서 6 동의 409. OnePlus8Pro, 288px·106dpi. 문서 6 서버 배포는 01:21 UTC | 배포 전 불일치. 기존 서버 수정 이후의 새 회귀로 보지 않음. 문서/서버 버전 대조 테스트와 iOS 게재 확인 후 최소 지원 버전 12 변경으로 출시 조건을 보강 |

로봇 판정 근거는 화면의 짧은 변 ≤320px **그리고** 밀도 <160dpi다. 기기 이름이나 미래 시계만으로 판정하지 않는다.
이번 조회에서 iOS 이슈는 없었다. 이는 실기기 알람 검증을 대신하지 않는다.

## 검증과 적용 범위

- 백엔드 전체 2,737개 통과(기존 스킵 63개), Android 1,041개 통과. 서버와 변경된 동의·버전·트랜잭션 테스트 파일 타입 검사, 저장소 코드 lint와 문서·플랫폼 규약 검사도 통과했다.
- iOS 전체 테스트 본문은 XCTest 1,233개(기존 스킵 9개)와 Swift Testing 63개에서 실패 0개였다. 마지막 수정 뒤 인증 테스트 80개와 UI 테스트 2개를 다시 실행해 `TEST SUCCEEDED`를 확인했다. UI는 등록 모달 취소/동의와 무료 이용권 게이트를 확인한다.

- 탈퇴 재시도는 실제 libSQL 트랜잭션 테스트에서 첫 UPDATE 뒤 520을 주입해 확인한다. 롤백 후 성공하고 `token_epoch`는 한 번만 증가해야 한다.
- 별도 단위 테스트는 COMMIT 응답 유실·롤백 실패 시 재시도하지 않는지, 첫 batch에서 닫힌 트랜잭션의 재시도를 확인한다.
- 앱/서버 수정은 아직 운영 배포 전이다. Sentry 이슈를 배포 완료 또는 운영 재발 없음으로 처리하지 않았다.
- 실기기는 연결되지 않았다(`adb devices` 빈 목록, `devicectl`에는 시뮬레이터만 표시). iOS 0.9초 끝 무음은 파일 길이·음량·무음 구간 자동 검사와 별도로 잠금 화면·앱 종료 상태에서 들어 봐야 한다.
