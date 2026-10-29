# 관리자 콘솔

오너가 스토어 콘솔·DB 를 열지 않고 **사용 현황을 보고, 사용자에게 알림을 보내는** 화면이다.
주소는 `https://api.alarm-talk.com/admin`(dev 는 `api-dev`)이고, 워커가 HTML 을 직접 그린다.

2026-10-23 에 새로 만들었다. 계기는 그날의 날씨 사고다 — 처리방침 재동의(최소 버전 5, 10-19 운영 반영)를
하지 않은 사람은 모든 API 가 403 이라 날씨 알람이 '날씨를 못 봤어요' 를 틀었는데, 그 사람들에게 알릴 길도,
몇 명인지 볼 곳도 없었다. 옛 콘솔(프로모 코드 이력)은 지웠다 — 코드로 유료 기능을 여는 길은 없다
(CLAUDE.md 「유료 기능은 스토어 결제로만 연다」).

## 들어가기

- 비밀번호(`ADMIN_SECRET`) 하나로 로그인하고 12시간 세션 쿠키(HttpOnly·Secure·SameSite=Strict, Path=/admin)를 받는다.
  스크립트용 HTTP Basic 도 받는다.
- 모든 POST 는 같은 출처만 받는다(Origin, 없으면 Referer). ⚠ 응답의 `Referrer-Policy` 를 `no-referrer` 로 바꾸지
  말 것 — 같은 출처 POST 의 Origin 이 `null` 이 되어 이 검사가 콘솔 자신을 막는다.
- 화면은 응답마다 새 nonce 를 붙인 인라인 스크립트만 실행된다(CSP, `connect-src 'self'`). 캐시하지 않는다.
  ⚠ 바깥 `securityHeadersMiddleware` 는 화면이 실은 정책을 **덮지 않는다** — 덮으면 화면 안 fetch 가 전부 막힌다.
- 세션이 끝난 뒤의 화면 안 요청(POST)은 리다이렉트가 아니라 401 `ADMIN_UNAUTHORIZED` 다.

## 화면

| 화면 | 보여 주는 것 |
| --- | --- |
| 개요(`/admin`) | 전체 가입자(누적 추이), 앱 접속 1·7·30일, **알람이 울린 사람**(7·30일, 안드로이드 울림 횟수 — 켜 둔 알람 수는 세지 않는다), 플러스, **재동의 필요**, 날짜별 가입·울림, 앱 빌드 분포(최신·권장·차단 표시), 알림 받을 수 있는 사람, **알람 문구 종류**(30일 — 알람 저장 기록, 아래), 이번 달(목소리·직접 입력·광고 보상), 사용 기록, **스토어 다운로드**(Play·App Store, 받은 마지막 날까지 30일), 날씨 데이터 상태, 최근 알림 |
| 사용 지표(`/admin/usage`) | 사용 기록 2판(`usage-events.md` §7)을 **기간·플랫폼·앱 버전·권한 출처**로 거른다: 첫 경험(샘플 시작→끝까지→로그인 성공→저장 시도→알람 준비, 단계별 사람 수와 앞 단계 기준 전환·로그인 결과), 음성 준비(범위별 시작·완료·실패·준비시간 중앙/90%·평균 크기·실패 코드·시작 캐시·끝나지 않은 시작), 알람 저장(시도·막힘·준비 완료·막힌 사유), 직접 입력(새 제작·실패·재사용 기기/서버·평균 글자·정산(새 제작과 서버 재사용 — 서버 재사용도 한 번 센다, 2026-10-27)·보상 사용), 광고 보상(제안·시청·대기·지급과 지연·30분 넘은 누락·사용), 결제와 권한(권한 출처별 사람·결제 화면·구매 확인의 체험/할인/정가·권한 변경), 관측한 알람 상호작용(플랫폼별) |
| 사용자(`/admin/users`) | 이메일·계정 id 로 찾기(없으면 최근 가입 50명 — 이름 칸은 2026-10-29 에 지웠다). 앱 빌드·마지막 접속·알림 기기·울림(30일)·플랜·상태(재동의 필요·탈퇴 대기), 그 사람에게 시험 발송 |
| 사용자 상세(`/admin/users/:id`) | 지금 권한의 근거(스토어 구독·관리자 지급), 저장된 등급, 이번 달 직접 입력, 목소리 삭제 예정, **플러스 기간 지급**(7일·1개월·끝나는 날 지정 → 확인 화면 → 지급), 지급 기록과 회수 |
| 알림 보내기(`/admin/push`) | 문구·받는 사람·미리보기·대상 수·시험 발송·전체 발송·발송 기록(이어 보내기) |
| 합성 운영(JSON — `/admin/tts/render-backlog`·`/admin/tts/usage`) | 다시 구울 목록·예상 글자·한 회차 계획(합성하지 않는다), 요청 종류별 합성 사용량·예산 설정·클론 슬롯 — 규칙은 [tts-render-and-budget.md](tts-render-and-budget.md) §4·§5 |
| 음성팩(`/admin/voice-packs`) | 추가 음성팩 목록·상세(클립 듣기·해시·크기, 내부 권리 정보, 남은 게시 조건, 검수·게시·중단 전이, 감사 기록) — 규칙은 [`voice-packs.md`](voice-packs.md) §4·§6 |

⚠ **켜 둔 알람 수를 지표로 쓰지 않는다**(2026-10-29 오너 — 사람마다 켜 두는 수가 달라 쓰임을 말하지 못한다). 알람 쓰임은 실제로
울린 것(사용 기록)으로 센다.

**알람 문구 종류 (30일)** 도 사용 기록에서 센다(2026-10-29 — 서버 알람 사본을 지웠다, [alarm-lifecycle.md](alarm-lifecycle.md)
「서버에는 알람이 없다」). 앱이 알람을 만들고 고칠 때 남기는 `alarm_created`·`alarm_updated` 의 `detail` = 문구 종류
([usage-events.md](usage-events.md) §1)를 **알람(계정 + 알람 id)마다 30일 안의 마지막 저장 하나**로 센다 — 그 뒤에 다시 고쳤으면
그 기록이 이기고, 지웠으면(`alarm_deleted`) 세지 않는다. 같은 시각이면 기록 id 로 가른다. 켜져 있는지는 기록에 없어 모른다.
1.3 앞 앱은 종류를 남기지 않고, 처리방침 8판에 동의하기 전의 기록은 서버가 종류를 비운다(`detail` 없음 — usage-events.md §1) —
둘 다 세지 않고 칸 아래에 그렇게 적는다. 라벨은 `weather`·`wake_weather` 날씨 ·
`fortune`·`wake_fortune` 운세 · `cheer`·`love` 응원 · `medication` 약 · `greeting`·`preset` 기본 인사말 · `wake` 기상 인사 ·
`manual` 직접 입력 · `recording` 직접 녹음 · `alarm_only` 알람음이고, 모르는 값은 그대로 보인다. (그 전의 '켜진 알람의 문구 테마'
는 서버 알람 행의 `bucket_id` 를 켜짐과 함께 셌다 — 테마 없는 직접 입력·직접 녹음·알람음은 '테마 없음' 하나로 묶였다.)

- 스토어 다운로드 수는 크론이 두 스토어의 보고서에서 받아 온다 — 아래 「스토어 다운로드」.
- 사람 계정만 센다 — 마이그레이션이 심은 시스템 계정(기본 목소리 보관용, `google_id` 가 `system:` 으로 시작)은 가입자·
  재동의·검색 어디에도 넣지 않는다. 재동의 필요에는 **동의 행이 하나도 없는 사람**도 들어간다(서버가 그 사람도 막는다).
- 숫자 하나의 기준이 바뀌면 그 칸 아래에 적는다(예: 울림은 처리방침 5판 이상 동의자의 기록만 모인다).
- **사용 지표의 뜻을 넓히지 않는다**(칸 아래 글로 적는다): 가입 전 기록은 없다(첫 칸은 '로그인·동의한 계정' 이다) ·
  iOS 의 울림은 '관측한 울림' 이고 관측이 없으면 0 이 아니라 '관측 없음' · 해제는 기상 성공이 아니다 · 준비 시작→저장의
  차이는 다운로드 대기시간이 아니다(작업이 단조 시계로 잰 `duration_ms` 만 쓴다, 이미 다 있던 `warm` 은 뺀다) · 끝나지 않은
  시작은 실패가 아니다 · 권한 출처는 사람마다 기간 안 마지막 기록의 값 하나라 겹쳐 세지 않는다(서버가 아직 무료 체험 구간을
  몰라 체험은 결제로 섞인다 — 구매 확인의 `store_offer` 로 가른다) · 광고 순수익과 제작 비용은 알 수 없다.
- 사용 지표의 2판 칸은 처리방침 8판 동의자부터 모인다(`usage-events.md` §7.5) — **그 전에는 화면이 비어 있는 것이 정상**이다.
- 디자인: 브랜드 색 하나(라이트 `#175fb0` · 다크는 앱 primary), 모서리는 앱 토큰(패널 18·컨트롤 12·배지 캡슐),
  시스템 라이트/다크·모션 줄이기·투명도 줄이기를 따른다. 화면 글자에 줄표(—)를 쓰지 않는다.

## 앱 빌드·접속 기록

두 앱은 모든 요청에 `X-App-Platform`(android|ios)·`X-App-Version`(안드로이드 versionCode, iOS 빌드 번호)을 싣는다.
서버는 그 값을 `user_app_presence`(사람 × 플랫폼, 마지막 빌드·마지막 접속)에 적는다.

- **동의 검사 앞**에서 적는다. 재동의를 안 해 403 을 받는 사람이야말로 알림으로 찾을 대상이다.
- 같은 isolate 안에서 같은 값이면 한 시간에 한 번만 쓰고, 응답을 기다리게 하지 않는다(`waitUntil`).
- 실패해도 요청은 그대로 간다 — 잃는 것은 접속 시각 하나다(잘못된 행이 영구히 남는 쓰기가 아니라서 fail-closed
  규칙의 대상이 아니다).
- **보관: 마지막 접속 뒤 90일**(처리방침 3장 '접속 로그 및 보안 로그 3개월'). 행은 덮어쓴다 — 이력을 쌓지 않고,
  처음 본 시각도 적지 않는다. 탈퇴 파기가 지운다.
- 한계: 콘솔 배포 **뒤에** 한 번이라도 서버에 접속한 기기만 빌드가 보인다.

## 스토어 다운로드

2026-10-26 에 붙였다(콘솔 2단계). 다운로드·설치 수는 우리 서버에 없고 **스토어의 보고서에만** 있다. 크론이 받아
`store_download_daily`(플랫폼 × 보고서 날짜 × 지표)에 적고, 개요가 플랫폼마다 패널 하나로 그린다.

### 원천

| | Google Play | App Store |
| --- | --- | --- |
| 어디서 | Play 콘솔 통계 보고서 — 개발자 계정의 Cloud Storage 버킷 `stats/installs/installs_<패키지>_<YYYYMM>_overview.csv` (UTF-16LE) | App Store Connect **분석 보고서 API** — 앱의 지속(ONGOING) 보고서 요청 → 보고서 → 하루치(DAILY) 인스턴스 → 조각(gzip TSV) |
| 무엇을 | 사용자 설치(막대), 기기 설치, 사용자·기기 삭제, 누적 사용자 설치, 설치된 기기, 설치·업데이트·삭제 이벤트 | 'App Downloads Standard' 의 최초 다운로드(막대)·재다운로드, 'App Store Installation and Deletion Standard' 의 설치·삭제. 업데이트·복원은 다운로드로 세지 않는다 |
| 늦음 | 그 달 파일을 하루에 한 번쯤 다시 쓴다(하루쯤 늦다). 지난달 파일도 다음 달 초에 고친다 | 하루치가 **다음 날쯤** 나온다. 보고서 요청을 처음 만든 뒤 첫 보고서까지 **하루 이틀**이고, 그 전 날짜는 없다 |
| 인증 | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`(결제와 같은 서비스 계정)으로 `devstorage.read_only` 토큰 | ES256 토큰(`aud=appstoreconnect-v1`, 20분) — 결제·로그인·푸시와 **다른 넷째 키** |

- 날짜는 **스토어 보고서의 날짜**다. 스토어가 하루로 묶어 준 숫자라 한국 시각으로 다시 자를 수 없다.
- 머리줄 이름은 대소문자·공백·기호를 지우고 비교한다(Play 가 이름을 바꿔 왔다 — 'Current Device Installs' 도 받는다).
  **아는 칸이 하나도 없으면 던진다** — 조용히 0 을 쌓지 않는다. 빈 칸은 0 이 아니라 없는 값이다.

### 크론

- 5분 크론 가운데 **한국 시각 0·3·9·12·15·18시의 35~39분 틱**에서만 돈다(하루 여섯 번). 한국·일본 날씨 슬롯(21·6시)을 피했다.
  설정이 하나도 없으면 DB 도 부르지 않는다.
- **멱등**: 같은 칸을 다시 받으면 덮는다. Play 는 회차마다 이번 달 파일(처음 연결한 날과 달 초 5일은 지난달도)을 통째로
  다시 받는다. App Store 는 받은 인스턴스를 `store_report_instances` 에 적어 다시 받지 않는다(35일 창, 65일 지나면 지운다).
- 한 인스턴스의 조각들은 더하고, **같은 날의 인스턴스끼리는 덮는다** — 애플이 같은 날을 다시 내면 더하는 순간 두 배다.
  덮는 쪽은 **처리일이 더 늦은** 인스턴스다(애플 「data completeness corrections」 — 겹치는 날짜는 가장 늦은 처리일 것을
  쓴다). 한 회차 안에서도, 회차를 건너서도 같다 — 칸마다 그 숫자를 낸 처리일(`source_date`)을 적고, 더 이른 처리일은
  덮지 못한다.
- 숫자 줄이 하나도 없던 인스턴스는 **아무것도 채우지 않는다.** 처리일은 보고서가 덮는 날짜가 아니고(이전 날짜를 실을 수
  있다), 설치 수는 다섯 명 미만이면 애플이 빼고 낸다 — 빈 인스턴스로는 그날이 0 인지 알 수 없다. 화면에는 '기록 없음' 이다.
  줄이 있는 날짜에서 그 보고서의 다른 지표가 빠졌으면 그것은 0 이다(예: 재다운로드가 없던 날).
- 하위 요청은 회차당 **24 개**까지(실행 하나의 ~50 을 다른 작업과 나눈다). 모자라면 받은 것만 적고 다음 회차가 잇는다 —
  인스턴스 하나의 조각을 다 받지 못하면 그 인스턴스는 남긴다(일부만 적으면 그날 숫자가 작아진다).
- 지속 보고서 요청이 없거나 애플이 오래 안 받아 멈췄으면(`stoppedDueToInactivity`) 하나 만든다. 그 회차는 거기서 끝난다.
- 실패는 플랫폼마다 따로다 — 한쪽이 실패해도 다른 쪽은 간다. `captureCron('scheduled.store_downloads', { platform })` 로
  올리고, `store_download_sync` 에 **우리가 만든 한 줄**만 남긴다(바깥 응답 본문·조각 주소는 남기지 않는다 — App Store 조각
  주소는 서명이 붙은 임시 주소다).

### 화면

- 플랫폼마다 패널 하나: **받은 마지막 날까지 30일** 막대(오늘까지로 자르면 아직 안 나온 날이 0 처럼 보인다), 30일 합,
  데이터 기준일, 마지막으로 받은 시각, 보조 숫자(누적 사용자 설치·재다운로드 등).
- 받지 못한 날은 막대를 그리지 않고 '기록 없음' 이라 쓴다. **없는 숫자를 0 으로 그리지 않는다.**
- 빈 상태는 셋을 가른다: 설정이 빠짐('연결 대기', 필요한 설정 이름) / 연결됐는데 아직 숫자 없음(다음 회차·보고서 대기
  안내) / 받다가 실패(마지막 오류).
- 표가 아직 없는 창(배포 → 마이그레이션 #138)에는 스토어 패널만 '불러오지 못했어요' 이고 개요의 나머지는 그린다.

### 오너가 넣을 설정

워커 비밀값(`.dev.vars.{dev,prod}` → `npm run secrets:sync:{dev,prod}`). 비어 있으면 그 플랫폼은 '연결 대기' 다.

| 플랫폼 | 값 | 어디서 |
| --- | --- | --- |
| Play | `PLAY_REPORTS_BUCKET` | Play 콘솔 → 앱 다운로드·보고서(통계) → '클라우드 저장소 URI 복사' 의 `gs://pubsite_prod_rev_<숫자>/` |
| Play | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`·`ANDROID_PACKAGE_NAME` | 이미 있다(결제). 그 서비스 계정에 Play 콘솔 '사용자 및 권한' 에서 **앱 정보 보기 + 대량 보고서 다운로드** 를 더한다(없으면 403) |
| App Store | `ASC_API_ISSUER_ID`·`ASC_API_KEY_ID`·`ASC_API_PRIVATE_KEY` | App Store Connect → 사용자 및 액세스 → 통합 → App Store Connect API → **팀 키**, 역할 **Admin**(보고서 요청을 처음 만들 때 필요). `.p8` 내용은 한 줄에 `\n` 이스케이프 |
| App Store | `APPLE_BUNDLE_ID` | 이미 있다(로그인). 앱을 이 번들 ID 로 찾는다 |

## 알림 보내기

### 대상

대상은 토큰 목록이 아니라 **조건**이다. 언제나 탈퇴 대기 중인 사람은 빼고, 알림 권한을 허용해 토큰이 있는
기기만 센다.

| 조건 | 뜻 |
| --- | --- |
| 플랫폼 | 전체 / 안드로이드 / iOS |
| 앱 빌드 미만 | 플랫폼마다 따로. 비우면 그 플랫폼은 빌드와 무관. 기록이 없는 기기는 '넣기' 를 골라야 들어간다 |
| 재동의 필요 | 서버가 실제로 막는 규칙(`lib/consent.ts` 의 `missingConsentTypesFrom` + 일반 필수 동의)과 같다. SQL 로 베끼지 않는다 |
| 최근 울림 | 최근 7일 안에 알람이 울린 사람(사용 기록의 울림·해제·다시 알림 — iOS 는 울림 순간을 못 봐 해제·다시 알림만 보인다) |
| 광고성 정보 수신 동의 | 마케팅 동의가 유효한 사람. **광고 알림이면 서버가 언제나 건다** |

### 순서와 규칙

1. **시험 발송** — 같은 종류·제목·본문으로, 지정한 계정의 모든 기기에. 60분 안에 한 대 이상 닿아야 전체 발송이
   열린다(서버가 확인한다). 기본 받는 사람은 워커 비밀값 `ADMIN_TEST_PUSH_EMAIL` 이다 — 저장소가 공개라 코드에
   적지 않는다.
2. **전체 발송** — 대상 수를 보여 주고 한 번 더 묻는다. 되돌릴 수 없다. 대상 수는 **그 수를 센 조건과 한 짝**이다 —
   조건을 바꾸면 숫자를 버리고, 지금 조건으로 다시 센 답이 나와야 보낼 수 있다. 확인 창의 숫자와 보내는 조건은 같은 묶음이다.
   기기가 2만 대를 넘어 다 세지 못하면 보내지 않는다(조건을 좁힌다) — 상한까지 센 숫자로 확인할 수는 없다.
3. 발송은 **기록 하나 + 여러 걸음**이다. 워커의 요청당 하위 요청 상한(FCM·APNs 는 기기마다 하나) 때문에 한 걸음에
   30대씩 보내고, 화면이 다음 걸음을 부른다. 창을 닫으면 발송 기록의 '이어 보내기' 로 같은 자리에서 계속한다.
4. 같은 기록을 두 창이 동시에 걸어도 커서를 비교 후 교체로 넘겨 한쪽만 보낸다.
   걸음은 **맡기와 끝내기**로 나뉜다 — 맡을 때 그 구간을 적고(`claim_*`), 보낸 뒤 지운다. 맡기의 응답이 끊겨 구간이 남으면
   2분 뒤 다음 걸음이 그 구간을 다시 보낸다(빠뜨리는 대신 몇 대가 두 번 받을 수 있다).
5. 발송 기록 목록은 **보내는 중인 기록을 개수와 무관하게 전부** 먼저 보여 준다 — 멈춘 발송이 새 기록에 밀려 '이어 보내기' 를 잃지 않게.
6. 발송 기록(`admin_push_jobs`)에는 **대상 토큰도 받는 사람도 적지 않는다** — 조건과 커서, 성공·실패 수만.

### 광고

⚠ **광고 알림은 운영 스위치 `ADMIN_AD_PUSH_ENABLED`(`true`/`1`)가 켜져 있을 때만 나간다 — 기본 꺼짐**(2026-10-29 오너: 광고는 당장
하지 않는다). 꺼져 있으면 광고의 시험 발송·전체 발송을 만들지 못하고(`ADMIN_PUSH_AD_DISABLED`), 켜 둔 동안 만든 광고 발송도 걸음이
멈춘다(`paused: 'ad_disabled'` — 켜면 발송 기록에서 이어 보낸다). 화면의 '광고' 선택도 잠긴다. 서비스 안내는 이 스위치와 무관하다.

정보통신망법 제50조 — **광고 알림**은:

- 광고성 정보 수신 동의자에게만(위 조건 강제). **시험 발송도 같다** — 받는 사람이 동의하지 않았으면
  `ADMIN_PUSH_TEST_RECIPIENT_NO_MARKETING_CONSENT`,
- 한국 시각 **08:00~21:00** 에만(시험 발송도. 밖이면 만들지 못하고, 보내는 도중 시간이 끝나면 걸음이 멈춘다 — 다음 날 이어 보낸다),
- 제목 앞에 `(광고)`, 본문 끝에 `수신 거부: 더보기 → 약관 및 동의` 를 서버가 붙인다.

업데이트·재동의·장애 안내는 **서비스 안내**라 이 제한을 받지 않는다. 안내라는 이름으로 혜택·이벤트를 보내지 말 것.

### 기기에 닿는 모양

- 안드로이드: FCM `notification` + `data.type = admin_notice`, 채널은 결제 안내와 같은 `voice_alarm_social_updates_v1`
  (기본 채널로 보내면 알람 소리가 난다). 앱이 **백그라운드면 시스템이 띄운다.** 앱이 앞에 있을 때는 옛 앱이 이
  종류를 몰라 보이지 않을 수 있다.
- iOS: APNs alert + `type = admin_notice`. 앱이 앞에 있으면 보이지 않는다(앱이 `willPresent` 로 띄우지 않는다).
- 실패는 대개 앱을 지운 기기다 — 그런 토큰은 발송 중에 지운다(`pruneStaleTokens`·`pruneDeadApnsTokens`).

## 사용자 상세와 기간 지급

- 목록의 이메일을 누르면 상세로 간다. 지급 전에 **지금 권한이 어디서 오는지**(스토어 구독·기존 지급)를 보여 준다.
- 지급은 두 걸음이다: 입력 → **확인 화면**(실제 끝 시각·겹침 안내·멱등 키) → 지급. 확인 화면을 두 번 보내도 한 번이다.
- 회수는 행마다 '회수 확인' 체크를 해야 보낸다. 그 지급만 끝내고, 다른 권한이 없으면 지금부터 3일 뒤 목소리를 지운다.
- 탈퇴 대기·시스템 계정에는 주지 않는다. 규칙 전문은 [`billing-lifecycle.md`](billing-lifecycle.md) 「관리자 기간 지급」.

## 광고 보상 대조 (읽기 전용 JSON)

`GET /admin/ad-rewards.json`(24시간 넘은 미확정 승인 세션·정산 못 한 SSV 콜백·상태별 수)과
`GET /admin/users/:id/ad-rewards.json`(한 사람의 세션·콜백·적립·잔액과 어긋남). 화면이 아니라 JSON 이고 **쓰기는 없다** —
재정산·고객 보상 지급은 후속이다. 규칙 전문은 [`ad-rewards.md`](ad-rewards.md) §7.

## 오류 코드

`ADMIN_UNCONFIGURED`(503) · `ADMIN_UNAUTHORIZED`(401) · `ADMIN_PUSH_COPY_INVALID`(400) ·
`ADMIN_PUSH_TEST_RECIPIENT_NOT_FOUND`·`ADMIN_PUSH_JOB_NOT_FOUND`(404) · `ADMIN_PUSH_TEST_REQUIRED`·
`ADMIN_PUSH_OUTSIDE_AD_HOURS`·`ADMIN_PUSH_TEST_RECIPIENT_NO_DEVICE`·`ADMIN_PUSH_TEST_RECIPIENT_NO_MARKETING_CONSENT`(409) · `ADMIN_PUSH_FAILED`(500) · 음성팩 가져오기의 `ADMIN_VOICE_PACK_INVALID`(400)·`ADMIN_VOICE_PACK_NOT_FOUND`(404)·`ADMIN_VOICE_PACK_LOCKED`(409).
앱은 이 코드를 받지 않는다.

## 구현 지도

| 규칙 | 백엔드 | 테스트 |
| --- | --- | --- |
| 로그인·세션·CSRF·화면 라우트 | `routes/admin.ts` | `admin-auth.test.ts`·`admin-csrf.test.ts`·`admin-console.test.ts` 「화면」 |
| 빌드·접속 기록 | `middleware/appPresence.ts`(동의 검사 앞 — `index.ts`) | `admin-console.test.ts` 「앱 빌드 기록」 |
| 기록 보관 90일 | `index.ts` 의 `APP_PRESENCE_RETENTION_DAYS` | `scheduled-prune.test.ts` |
| 탈퇴 파기 | `lib/account-deletion.ts` 의 `purgeUserAccount` | `account-purge-residue.test.ts` |
| 개요·사용자 숫자 | `lib/admin/metrics.ts` | `admin-console.test.ts` 「화면」 |
| 알람 문구 종류(30일 · 알람마다 마지막 저장 · 지운 알람 제외 — 서버 알람 사본이 아니라 사용 기록) | `lib/admin/metrics.ts` 의 `loadOverview`(6 문구 종류) · 라벨 `lib/admin/pages.ts` 의 `THEME_LABELS` · 기록은 [usage-events.md](usage-events.md) 구현 지도 「알람 저장의 문구 종류」 | `admin-console.test.ts` 「화면」 — 알람 문구 종류는 알람 저장 기록에서 센다 |
| 대상 조건 | `lib/admin/audience.ts`(동의 판정은 `lib/consent.ts` 의 `latestConsentsFromRows`) | `admin-console.test.ts` 「대상 고르기」 |
| 시험 발송·전체 발송·걸음·광고 규칙 | `lib/admin/push-jobs.ts` | `admin-console.test.ts` 「문구」·「발송」 |
| 화면·토큰·동작 | `lib/admin/ui.ts`·`lib/admin/pages.ts` | — |
| 표 | 마이그레이션 #133(`user_app_presence`·`admin_push_jobs`) | `migrations.lock.json` |
| 스토어 다운로드 — 받기·멱등·예산·일정 | `lib/admin/store-downloads.ts`(크론 `index.ts` 의 `scheduled.store_downloads`)·`lib/admin/store-sources.ts`(Play GCS·App Store Connect API·ES256 토큰) | `admin-store-downloads.test.ts` 「크론」·「App Store Connect 토큰」 |
| 스토어 보고서 해석(UTF-16LE·BOM·머리줄 변형·gzip TSV) | `lib/admin/store-reports.ts` | `admin-store-downloads.test.ts` 「Play 통계 CSV」·「App Store 분석 보고서」 |
| 스토어 패널(빈 상태 셋·기록 없음) | `lib/admin/pages.ts` 의 `storePanel`·`lib/admin/ui.ts` 의 `columnChart` | `admin-store-downloads.test.ts` 「화면」 |
| 스토어 표 | 마이그레이션 #138(`store_download_daily`·`store_download_sync`·`store_report_instances`) | `migrations.lock.json`·`account-purge-residue.test.ts`(개인정보 없음) |
| 사용자 상세·기간 지급 | `routes/admin.ts`·`lib/admin/user-detail.ts`·`lib/admin/grant-pages.ts`·`lib/plan-grants.ts`(#134) | `plan-grants.test.ts` 「콘솔」 |
| 합성 운영 보기(JSON) | `routes/admin.ts`·`lib/admin/tts-ops.ts`·`lib/render-backlog.ts`(#139) | `tts-render-budget.test.ts` 「관리자 JSON」 |
| 사용 지표 | `lib/admin/usage-metrics.ts`(거르기·집계)·`lib/admin/usage-pages.ts`(화면)·`routes/admin.ts` 의 `/usage` | `admin-usage-metrics.test.ts` |
| 광고 보상 대조(읽기 전용) | `routes/admin.ts`·`lib/admin/ad-rewards.ts`(#141) | `ad-reward-sessions.test.ts` 「관리자 대조」 |
| 음성팩 검수·게시 | `routes/admin.ts`·`lib/admin/voice-pack-pages.ts`·`lib/voice-packs.ts`(#144) | `voice-packs.test.ts` 「관리자」 |
