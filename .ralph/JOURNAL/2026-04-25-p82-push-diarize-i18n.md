# P82 — 백엔드 푸시 알림 + 화자 분리 i18n

## 선택한 항목
BACKLOG 고갈 → 보안/i18n 감사 수행 중 발견: FCM 푸시 알림 body와 diarize speaker label에 하드코딩 한국어가 남아있어 영어 사용자 UX 저하.

## 접근

### 문제 발견 경로
1. `any` 타입 감사 → 0건 (production 코드 clean)
2. 하드코딩 한국어 감사 (모바일) → 0건 (i18n 완료)
3. 인증 미들웨어 감사 → false positive 1건 (diarize는 api 라우터 산하로 이미 보호됨)
4. 하드코딩 한국어 감사 (백엔드) → **2건 발견**:
   - `fcm.ts`: `알람이 울립니다`, `새 쪽지가 도착했어요`
   - `voice.ts`: `화자 ${i + 1}`

### 구현
1. `fcm.ts`에 `PushLocale` 타입 + `pushTexts` ko/en 맵 추가
2. `sendAlarmPush`, `sendNotePush`에 optional `locale` 파라미터 (기본 `'ko'`)
3. `notes.ts`에서 `Accept-Language` 헤더 파싱 → `'en'` 시작이면 영문, 아니면 한국어
4. `voice.ts` diarize: `화자 N` → `Speaker N` (모바일 클라이언트는 이미 `t('voiceDiarize.speaker')` 사용하므로 API label 필드는 참조용)
5. `fcm.test.ts`에 sendNotePush 5 tests + sendAlarmPush locale 2 tests 추가

### 대안: DB에 user locale 저장
cron 트리거(알람 발화)에서는 요청 헤더가 없어 Accept-Language 사용 불가. 완전한 해결은 users 테이블에 `locale` 컬럼 추가 필요. 현재는 cron 알람은 기본 'ko', 직접 API 호출(쪽지 전송)은 Accept-Language 활용.

## 변경 파일 (4개)
1. `packages/backend/src/lib/fcm.ts` — PushLocale 타입, pushTexts 맵, locale 파라미터
2. `packages/backend/src/routes/voice.ts` — diarize label 영문화
3. `packages/backend/src/routes/notes.ts` — Accept-Language 추출 + locale 전달
4. `packages/backend/test/fcm.test.ts` — 7 신규 테스트

## 검증
- typecheck: backend 0 errors, mobile 0 errors
- 테스트: backend 798/798 (793 → 798, +5 sendAlarmPush locale + sendNotePush 신규), mobile 662/662

## 다음 루프 참고
- cron 기반 알람 푸시는 여전히 기본 'ko' — users 테이블에 locale 컬럼 추가 시 개선 가능
- `data/presets.ts`의 프리셋 메시지는 의도적으로 한국어 유지 (TTS 콘텐츠)
- 백엔드 error 필드의 한국어 문자열은 error_code 도입(P68~P71)으로 클라이언트에서 무시됨
