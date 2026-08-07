# 백엔드 계약 체크리스트

2026-07-21(옛 iOS 스냅샷) → HEAD 사이 403 커밋에서 바뀐 것 중, **iOS 가 반드시 손봐야 하는 것**만.
전체 변경 내역은 `분석/02-계약변화.md` 에 있다.

**Apple 로그인·결제 2건(P0)은 이번 범위 밖이다** — 백엔드 라우트·DB 컬럼·법무문서가 3중으로
제거돼 앱만 고쳐선 성립하지 않는다. 별도 사이클에서 법무 개정과 묶어 처리한다.

---

## "옛 iOS 를 고쳐 쓴다면 반드시 손봐야 하는 것" 체크리스트

**차단급 (P0 — 안 고치면 앱이 아예 안 돈다)**

- [ ] **`GET /user/me` → `GET /auth/me` 전환.** 사용자 부트스트랩 경로가 404. 응답 형태도 다르다(`stats` 없음, `deletion_status`/`dynamic_prompt_settings` 추가).
- [ ] **rolling refresh 구현.** `GET /auth/me` 가 내려주는 `token` 을 매번 갈아 끼워야 한다. 안 하면 90일 뒤 조용히 로그아웃되고, 소유자 게이트에 걸려 **알람이 사라지고 울리지도 않는다.**
- [ ] **`push_tokens.platform='ios'` 를 DB 가 거절한다** (#88). 마이그레이션을 새로 하나 추가해 CHECK 를 되돌리지 않으면 FCM/APNs 토큰 등록 자체가 불가 → 가족알람·목소리공유·철회 신호 전부 못 받는다.
- [ ] **Apple 로그인 제거 대응.** `POST /auth/apple` 없음. Google/이메일만 남는다. Sign in with Apple 을 되살리려면 라우트·스키마·`users.apple_id` 컬럼을 전부 다시 만들어야 하고, **App Store 심사 규정상 소셜 로그인이 있으면 Apple 로그인 필수**라 이건 선택이 아니다.
- [ ] **Apple 결제 전면 재구축.** 위 「현재 상태」 3계층 + 법무 문서 개정 + 정책버전 상향까지.
- [ ] **`POST /user/consents` 에 `document_version` 필수.** 안 보내면 400 `DOCUMENT_VERSION_REQUIRED`, 값이 `'4'` 와 다르면 409 `POLICY_VERSION_MISMATCH`. 법무 문서 전문을 앱 번들에 싣고 그 버전을 보내야 한다.
- [ ] **`GET /app/version` 하한이 Android versionCode 21.** `lib/app-version.ts` 는 platform 파라미터를 받아도 **무조건 Android 정책을 돌려준다**. iOS 빌드번호가 21 미만이면 즉시 강제 업데이트 차단 화면. iOS 분기를 서버에 추가해야 한다.

**계약급 (P1 — 화면이 깨지거나 데이터가 틀어진다)**

- [ ] **삭제된 7개 라우트 호출부 전부 제거** — library / friend / gift / stats / family-invite / alarm-source / billing-apple. 대응 기능(즐겨찾기·친구·선물·통계)은 제품에서 사라졌다.
- [ ] **`POST /billing/redeem` → `POST /code/register`** 로 통합. 바우처·가족초대·프로모를 서버가 판별한다.
- [ ] **`POST /family/alarms` → `POST /family/alarms/voice`**.
- [ ] **`DELETE /alarm/:id/decline` → `POST /alarm/:id/decline`** (메서드 변경).
- [ ] **`GET /alarm/tick` · `GET /alarm/:id` 제거** — 서버측 발사 판정 없음. 발사는 전적으로 로컬(iOS면 `UNNotificationRequest`), 서버는 동기화만.
- [ ] **`GET /alarm/declined` 신규 소비 구현** — `alarm_ids`(지운다) vs `revoked_alarm_ids`(목소리만 걷어낸다) 를 정반대로 처리. 페이지네이션은 두 배열 합만큼 offset 전진.
- [ ] **`GET /tts/presets` 제거** — 문구 출처를 `GET /tts/stock-clips` 로 옮겨야 한다.
- [ ] **알람 필드 제거 대응**: `speaker_id`·`raw_audio_url`·`raw_audio_duration_ms` 를 보내면 무시되고, 응답에서도 안 온다. 내 알람 녹음은 **서버에 올리지 않고 폰에만** 둔다.
- [ ] **`bucket_id` 지원** — 무료 버킷 회전 알람. 없으면 대표 클립 단일 재생으로 폴백.
- [ ] **FCM data-only 타입 4종 처리**: `family_alarm` / `voice_share_changed` / **`voice_access_revoked`(신규)** / **`plan_changed`(신규)**. `voice_access_revoked` 를 무시하면 탈퇴자의 복제 목소리를 계속 들고 울린다 — 음성 생체정보 파기 요구 위반.
- [ ] **동의 상태 신규 필드 대응**: `needs_consent`(차단) vs `needs_collection`(화면 표시) 를 구분, `sensitive_missing` 으로 목소리 등록 화면 인라인 동의, `has_prior_consent` 로 최초/재동의 문구 분기, `optional` 목록은 체크 없이 CTA 통과.
- [ ] **`pending_deletion` 상태에서 `GET /user/me` 로 복구화면을 그리던 경로가 죽는다.** 이제 허용 API 는 `DELETE /user/me/deletion` 과 `POST /push/unregister` 뿐 — 복구 화면은 `GET /auth/me`(authMiddleware 밖)로만 채울 수 있다.
- [ ] **`401 AUTH_USER_NOT_FOUND` 신규 처리** — 자동 계정 생성이 없어졌다.
- [ ] **`GET /voice/draft-quota` 소비** — draft 시도(3)와 월간 등록(1)이 별개 쿼터.
- [ ] **표시 이름 규칙을 shared 와 맞춘다** — 30자(목소리 50자), 제어·제로폭·양방향 문자 제거, 줄바꿈→공백, 서러게이트 쌍 안 가르기. 옛 iOS 는 64자·trim 없음이라 서버가 거절한다.

**동작 규약급 (P2 — 코드는 돌지만 사용자가 손해를 본다)**

- [ ] 1회성 오버레이 준비신호 3종 도입(응답 전에 소진 플래그 태우지 않기).
- [ ] 알람 편집기 last-used 기본값(목소리/문구종류/무료버킷), 저장 성공 시에만 기록, 새 알람에만 적용.
- [ ] 권한 게이트 문구를 "울리지 않아요" 에서 권한별 사실로 교체, 알람 스위치는 저장된 `enabled` 에만 묶기.
- [ ] 세션 정리 시 계정별 신호만 리셋(`versionChecked` 는 유지), 자동 401 에서 취향 저장소를 지우지 않기.

**참고 경로 (전부 절대경로)**
- `C:\Users\gyuwo\Desktop\AlarmTalk\packages\backend\src\index.ts` — 라우트 마운트 현황
- `C:\Users\gyuwo\Desktop\AlarmTalk\packages\backend\src\lib\migrations.ts` — 78~93 신규
- `C:\Users\gyuwo\Desktop\AlarmTalk\packages\backend\src\middleware\auth.ts` — sub=users.id 통일, 자동생성 제거
- `C:\Users\gyuwo\Desktop\AlarmTalk\packages\backend\src\lib\jwt.ts` — `DEFAULT_TTL_SECONDS` 7일→90일
- `C:\Users\gyuwo\Desktop\AlarmTalk\packages\backend\src\lib\consent.ts` — `CURRENT_POLICY_VERSION = '4'`
- `C:\Users\gyuwo\Desktop\AlarmTalk\packages\backend\src\lib\app-version.ts` — minSupported 21 / latest 23
- `C:\Users\gyuwo\Desktop\AlarmTalk\packages\backend\src\lib\account-deletion.ts` — `RevokedRecipientTarget`, `purgeUserAccount` 반환값
- `C:\Users\gyuwo\Desktop\AlarmTalk\packages\shared\src\schemas\auth.ts` — 표시이름 단일 출처
- `C:\Users\gyuwo\Desktop\AlarmTalk\apps\android-native\app\src\main\java\com\alarmtalk\app\network\` — 현행 클라 계약 레퍼런스 (8개 Api.kt)

**비용 요약**: 옛 iOS 가 모르는 것은 "엔드포인트 몇 개"가 아니다. ① 세션 모델이 통째로 바뀌었고(sub 의미·90일·rolling), ② 받은-알람 소유권과 목소리 철회라는 **새 도메인 개념**이 생겼으며, ③ iOS 자체가 DB CHECK 제약 수준에서 배제됐고, ④ Apple 로그인/결제는 코드·스키마·법무문서 3중으로 제거됐다. ③④ 만으로도 백엔드 마이그레이션 추가와 법무 문서 개정(→ 전원 재동의)이 선행 조건이다.