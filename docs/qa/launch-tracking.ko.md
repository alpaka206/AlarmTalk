# 출시 전 미해결 트래킹

> 출시 전에 남은 보안·법무·동작 이슈만 추린 추적용 문서다.
> 6/22 보안감사(`docs/security/prerelease-audit-*.md`, 추적 제외)와 `docs/qa/LAUNCH_AUDIT.md`를 **현재 코드와 대조**해 정리했다.
> 이미 고친 항목과 캐릭터/성장 기능 제거로 사라진 항목은 여기서 뺐다.
> 구체적인 익스플로잇 재현 절차·내부 경로·시크릿 값은 이 문서에 적지 않는다(그건 gitignore된 보안감사 원본에만 있다).

마지막 대조: 2026-07-15 기준(전 항목 코드 재확인). 분류는 **미해결 / 주의 / 신규**.

---

## 🔴 출시 막는 항목 (Blocker)

### L1 — 음성 제공자 법무·배선 정합성
런타임에서 생체 음성(클론)을 처리하는 경로는 **ElevenLabs**로 정한다.
- 2026-07-15 재확인: 코드 경로는 ElevenLabs로 확정돼 있음(`lib/elevenlabs.ts`, `lib/voice-provider.ts`). 남은 것은 법무 문서 쪽.
- 개인정보처리방침·약관·동의·스토어 라벨은 실제로 음성을 보내는 제공자, 처리 국가, 하위수탁자와 **일치**해야 한다.
- 국외이전 동의는 음성 AI 처리와 동적 문구/번역 경로에서 계속 서버가 강제한다.
- 법무 문서 정합성은 법무 문서 정리 작업에서 함께 다룬다.

---

## 🆕 신규 (2026-07-15 추가)

### S1 — FCM 푸시토큰 수집 개시 → 개인정보처리방침 고지·버전 bump 필요
PR #548로 푸시토큰 수집이 실동작을 시작했다: `POST /api/push/register`·`/unregister`(`routes/push.ts`)가 `push_tokens`에 저장하고, Android `AlarmTalkMessagingService`가 토큰 등록과 가족알람 data-only 푸시를 처리한다.
- 개인정보처리방침에 수탁사(Google Firebase Cloud Messaging)와 수집 항목(푸시 토큰) 고지를 반영하고 **정책 버전 bump(재동의 트리거)** 가 필요하다.
- `docs/legal/compliance-notes.ko.md`의 W3(수탁 항목 추가) 및 아래 ⚪ '개인정보처리방침 버전' 항목과 **한 번에** 처리할 것.

### S2 — Play Console 외부설정 체크리스트 (빌링 감사 이관)
`docs/qa/archive/google-play-billing-audit-2026-07-08.md`에서 이관. 코드 측 P0 2건(표시가격 하드코딩, RTDN 토큰 상수시간 비교)은 **수정 완료**.
- acknowledge: confirm 경로에서 서버가 처리하고, 5xx·네트워크 실패 시 최대 3회 재시도한다(`billing-google.ts` acknowledge 블록). 단 **요청 내 재시도뿐 지속 재시도 큐는 없어** 3회 모두 실패하면 3일 후 Play 자동환불 위험이 남는다 — 실결제 E2E에서 확인.
- 리포 밖 외부설정(코드로 확인 불가, 사용자 작업):
  - [ ] 구독 상품 `personal_monthly`/`couple_monthly`/`family_monthly` + 베이스플랜 게시
  - [ ] 서명된 릴리스 트랙에 결제 가능한 빌드 업로드 + 라이선스 테스터 등록
  - [ ] 서비스계정에 해당 앱 Play Developer API 권한 부여
  - [ ] RTDN: Pub/Sub 토픽 + push 구독 URL에 `?token=<GOOGLE_RTDN_VERIFICATION_TOKEN>` 설정
  - [ ] Pub/Sub push에 OIDC 서비스계정 인증을 인프라 레벨로 함께 설정(코드엔 OIDC 검증 없음)
  - [ ] 표시 가격이 실제 Play 청구 통화/금액과 일치하는지 실기기 확인
  - [ ] 실결제 E2E 1회 완주: 구매→confirm 200→acknowledge→RTDN 왕복

---

## 🟠 미해결 (High~Medium — 출시 전 처리 권장)

### M1 — 음성 클론 업로드에 파일 바이트 크기 상한이 없음 *(2026-07-15: 완화됨·잔존)*
클론 등록(`/voice/clone`, `voice-profile.ts`)은 여전히 파일 크기(`audioFile.size`) 검사 없이 MIME·길이(초)만 검증하고 `arrayBuffer()`로 통째 적재한다. 다만 전역 `bodyLimitMiddleware`(`middleware/bodyLimit.ts`)가 content-length 25MiB 초과를 413으로 거절해 상한 자체는 있다.
- 잔존: content-length 헤더 기반이라 헤더 없는 요청은 우회 가능하고, 25MiB 이내의 대형 파일은 여전히 메모리에 통째로 올라간 뒤 유료 제공자로 전달된다(비교: 일반 업로드는 파일 단위 25MiB, 알람 원본은 5MiB 검사 존재).
- 권장 유지: 클론 경로에도 파일 단위 바이트 검사(예: 25MiB, 초과 시 413) 추가.

---

## 🟡 미해결 (Low — 가능하면 정리)

### M3 — 애플 서버 간 결제 알림(ASSN V2) 부재 *(2026-07-15: 축소 — 구글은 해결, 애플은 iOS 보류로 비차단)*
구글 RTDN은 완비됐다: `billing-google-rtdn.ts`가 Pub/Sub push를 받아 purchaseToken 권위 재조회 후 갱신/예약취소/정지/해지를 동기화하므로, 구글 측 환불·취소 반영 지연은 해소. 애플 App Store Server Notifications V2는 여전히 없으나 **iOS는 미운영·보류**라 Android 출시를 막지 않는다 — iOS 재개 시 필수 작업으로 이월.

### N1 — 소셜 로그인 nonce/리플레이 검사 공백 *(2026-07-15: 애플도 부분 공백으로 정정)*
애플 로그인은 클라이언트가 raw nonce를 보낸 경우에만 검증한다(`auth.ts`): 토큰에 nonce 클레임이 있는데 raw nonce가 빠지면 거부하지만, **둘 다 없는 legacy 요청은 경고 로그만 남기고 통과** — 그 경로에선 리플레이 방어가 비활성이다. iOS 재개 시 nonce 필수화(무-nonce 요청 거부)로 이월. `verifyGoogleIdToken`은 iss/aud/exp/email_verified만 검사하고 nonce 검사가 없다. id_token 재전송(리플레이) 방어가 한 겹 부족하다.

### N2 — 결제 웹훅(RTDN) 인증 토큰이 쿼리스트링에 있음 *(2026-07-15: 축소)*
토큰 비교는 상수시간 비교(`timingSafeEqualStr`)로 교체돼 타이밍 오라클은 해소(`billing-google-rtdn.ts`). **쿼리스트링(`?token=`) 위치만 잔존** — 오류 시 모니터링(요청 URL)에 토큰이 캡처될 수 있으니 헤더 이동 또는 URL 스크럽 권장.

### N3 — 애플 거래 JWS 서명체인 미검증 *(2026-07-15: 변동 없음, iOS 보류로 낮음)*
`billing-apple.ts`의 `decodeJwsPayload`는 여전히 서명/인증서 체인(x5c) 검증 없이 디코드만 한다. 현재는 애플 TLS 엔드포인트 응답에만 쓰여 당장의 위험은 낮고 iOS 자체가 보류 상태. 향후 클라이언트/S2S 입력에 재사용되면 위조 거래를 수용할 수 있으므로 iOS 재개 시 서명 검증을 붙일 것.

### N5 — 제공자(ElevenLabs) 오류 원문이 클라이언트 응답에 반사됨 *(2026-07-15: 변동 없음)*
`elevenlabs.ts`가 제공자 오류 본문을 Error 메시지에 그대로 담고, TTS 실패(`tts.ts`의 `TTS_GENERATION_FAILED` `detail`)와 클론 실패(`voice-profile.ts`의 `VOICE_CLONING_FAILED`/`VOICE_SLOT_EXHAUSTED` `detail`)가 이를 클라이언트로 내려보낸다. 안정적인 에러코드로 매핑하고 원문은 서버 로그에만 남기는 게 좋다.

### N6 — TTS 출력 포맷을 제공자에 명시하지 않고 기본값에 의존 *(2026-07-15: 변동 없음)*
`elevenlabs.ts` `textToSpeech`는 `output_format` 미지정에 `Accept: audio/mpeg` 헤더만 보낸다. 캐시 키·포맷 컬럼은 'mp3'를 가정하므로, 제공자가 기본 포맷을 바꾸면 저장 바이트와 메타가 어긋날 수 있다. 출력 포맷을 명시하고 캐시 키에 포함하면 장기 캐시가 안전.

---

## ⚪ 운영·문서·앱 위생 (확인/결정 필요)

- **시크릿 로테이션**: 작업 트리의 dev 시크릿 파일(미커밋이지만 실키)은 출시 전 전량 로테이션하고 wrangler secrets로 옮긴다. 시크릿 값·경로는 여기 적지 않는다. *사용자 작업 필요.*
- **개인정보처리방침 버전(재동의)**: 정책 버전을 올려야 기존 사용자에게 재동의 경로가 뜬다. ElevenLabs 기준 수탁사 고지 개정 + **FCM 푸시토큰 수집 고지(위 S1)** 와 함께 버전 bump 필요(법무 문서 작업과 연동).
- **법무 고지 정합성**: Vertex(알람문구·사주 데이터 국외이전), 사주 항목(성별/생년월일/출생시각) 명시, FCM/PortOne 수탁사 고지 등은 법무 문서 정리 작업에서 코드 동작과 대조해 마무리.

---

## ✅ 대조 결과: 해결로 확인된 항목 (참고)

### 2026-07-15 대조에서 해결·무효 확인

- **M2 — 화자분리(diarize) 경로** → **무효(경로 제거)**. 백엔드에 diarize/화자분리 엔드포인트가 더 이상 존재하지 않는다(업로드 수신 경로는 `/voice/upload`·`/voice/clone`·알람 원본 3곳뿐이고 각각 MIME·크기 또는 전역 바디 캡 검증 존재).
- **N4 — 외부 제공자 클론 삭제 실패 무시** → **해결**. 프로필 삭제 트랜잭션이 먼저 `pending_external_deletions` 큐에 적재 후 즉시 삭제를 시도하고, 성공 시 큐 제거·실패 시 로깅 후 큐에 남겨 cron `drainExternalDeletions`가 배치 재시도한다(`voice-profile.ts`, `lib/audio-retention.ts`).
- **N7 — 선물 수락 동시성** → **해결**. 수락이 `status='pending'` 조건부 UPDATE + rowsAffected 확인으로 원자화돼, 전환에 성공한 요청만 라이브러리에 INSERT 한다(`gift.ts` accept 라우트). 동시 수락으로 인한 중복 복사본은 발생하지 않는다.
- **N8 — 이메일 코드 재전송 쿨다운** → **해결**. `auth.ts`가 per-email 재발송 쿨다운(`EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS`)과 일일 상한(`EMAIL_VERIFICATION_DAILY_CAP`)을 발급·재발급 두 경로 모두에서 강제한다.
- **N2 (부분)** — RTDN 토큰 상수시간 비교 적용(위 N2 항목 참조, 쿼리스트링 위치만 잔존).
- **M3 (부분)** — 구글 RTDN 수신·권위 재조회·환불/취소 동기화 완비(위 M3 항목 참조, 애플만 iOS 보류로 이월).

### 이전 대조에서 해결로 확인된 것들(추적 종료)

**백엔드 보안/인증**
- OAuth `email_verified` 강제(구글·애플) + 애플 클라 이메일 fallback 제거 → 계정연동 탈취 차단.
- 토큰 폐기(token_epoch) + 로그아웃 엔드포인트 + 폐기 토큰 거부(TOKEN_REVOKED). raw 제공자 토큰 직접 수용 제거(앱 JWT 전용).
- note 오디오 로더 하드닝 — 임의 https 프록시 차단 + r2 키 소유자 네임스페이스 강제(교차 테넌트 읽기·SSRF 차단).
- 알람 PATCH의 message_id/voice_profile_id 소유권 재검증(IDOR 차단).
- 서버측 동의 강제 미들웨어(일반 필수 동의 403 게이트) + 음성 클론에 voice_biometric, 국외이전 경로에 overseas_transfer 동의 강제.
- 로그인 실패 응답 일원화 + 미존재 계정 더미 bcrypt(계정 열거·타이밍 오라클 제거).
- init-db/seed 전 환경에서 시크릿 헤더 요구(미인증 파괴/비용 표면 제거).
- auth 전용 엄격 레이트리밋(별도 버킷).
- pending_deletion 상태 확인 불가 시 fail-closed로 전환.
- AUTH 401 경로 로그를 구조화 로깅으로 교체(토큰 원문·구성 단서 미노출).
- 계정삭제 userPk 조회에 apple_id 포함(레거시 애플 계정 자식 PII 고아화 해소).
- `GET /user/search`가 타인 이메일을 반환하지 않음(null 처리).
- `email_verification_codes` 만료분 크론 정리 추가.
- 결제 스텁(checkout/change-plan)·test-codes가 production에서 항상 비활성 + 발급자 하드코딩 개인 이메일 제거.
- 바우처 사용 시 멤버 있는 소유 그룹 자동 해체 방지 가드(OWNS_ACTIVE_GROUP).
- 가족 초대 좌석 초과 TOCTOU 차단(원자적 조건부 INSERT).

**음성 파일 라이프사이클**
- 메시지 삭제 시 R2 오브젝트 삭제 큐 적재.
- raw-alarms 업로드 추적 테이블 + 미연결 클립 TTL 정리 + 계정삭제 정리.
- 알람 PATCH로 녹음 교체 시 이전 R2 정리.
- TTL 정리 시 messages.audio_url 댕글링 포인터 NULL 처리 + 활성 알람이 쓰는 TTS 보존.

**일일 TTS 한도 레이스(B/HIGH)** — 일일 TTS 횟수 제한 자체가 폐지됨(컬럼 제거). 레이스 조건은 더 이상 존재하지 않음.

**안드로이드 동작**
- 알람 발화 FGS 백그라운드 시작 크래시 가드(try/catch + 풀스크린 알림 폴백).
- 시간대/DST 변경 시 재스케줄 리시버(ACTION_TIMEZONE_CHANGED/TIME_CHANGED).
- 동적 보이스 새로고침 워커 스케줄링 연결(데드코드 해소).
- Geocoder 오류 시 코루틴 행 수정.
- 캡처 방지(FLAG_SECURE) 적용(dev 빌드는 의도적으로 해제).
- UI/접근성 다수(코치마크 maxWidth, 시간피커 폰트스케일, AlarmRow 말줄임+접근가능 삭제, 온보딩 \n 제거, LazyColumn key, base64 IO 디스패처, 데드코드 제거 등).

**캐릭터/성장 제거로 무효화된 항목**
- character `/xp` 클라 권위·논스 중복지급·streak 마일스톤 중복지급 관련 finding 전부 → 기능 제거로 코드 자체가 사라짐(무효).
