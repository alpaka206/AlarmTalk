# 음성 AI 수탁사 Perso(이스트소프트) 처리 노트

실서비스에서 음성 클론·TTS 제공자를 **ElevenLabs → Perso**로 전환할 때 법무·개인정보 문서에
반영할 사실과 근거를 정리한다. Perso가 동등 기능(보이스 클론/TTS)을 B2B로 제공한다는 전제이며,
이 문서는 법률 자문을 대체하지 않는다. **출시 전 Perso와의 계약(서비스 계약·DPA) 및 법무 검토로 최종 확정**해야 한다.

작성 기준일: 2026-06-19. 출처는 문서 하단 참조(Perso 공개 약관/방침 원문).

## 1. 수탁사 식별 정보

| 항목 | 내용 |
| --- | --- |
| 서비스 | Perso(perso.ai) — AI 더빙·보이스 클론·TTS·AI 아바타 |
| 운영사 | 이스트소프트 (ESTsoft, Inc.) |
| 국가 | 대한민국 (준거법: 대한민국) |
| 개인정보 보호책임자 | Perso 측 CTO(Gwon Taek-sun) — 방침 명시 |
| 문의 | perso.info@estsoft.com / 1544-8209 |
| 방침 시행일 | 개인정보처리방침 2025-10-31, 이용약관 2025-06-26(영문본 기준) |

## 2. Perso 정책에서 확인한 핵심 사실 (우리 문서 반영 근거)

1. **수집 항목**: text, voice, scripts, images, videos, **생체정보(biometric data)** + 계정(이메일/비밀번호/이름/휴대폰), IP, 쿠키, 접속 로그.
2. **AI 학습 이용 (가장 중요)**: 이용약관 제4조 및 방침에 *"회사는 회원이 제공한 데이터를 서비스 품질 개선을 위한 AI 학습에 이용할 수 있다"*, *"회원은 AI 학습 이용에 동의를 거부할 수 있으나 거부 시 일부 서비스 이용이 제한될 수 있다"*고 명시. 방침에도 *"input provided by users may be employed to improve Services or to train models"*.
3. **결과물 소유권/라이선스**: 생성 결과물은 회원 소유. 단 회원은 회사에 **서비스 개선을 위한 제한적 라이선스**를 부여(약관 제4조 제2항).
4. **생체정보 취급**: 약관 제5조 — 음성 등 생체정보는 서비스 제공 목적으로만 수집·이용하고 **암호화하여 분리 저장**, 목적 달성 후 파기, 회원은 언제든 파기 요청 가능.
5. **보유기간**: 탈퇴 후 1개월, 분쟁처리 1개월, 법정 의무 3~5년, **AI 모델은 관련 법령이 허용하는 기간** 보관.
6. **장기 미사용**: 회원이 1년 이상 미사용 시 생성 콘텐츠·업로드 데이터 일괄 삭제·초기화(약관 제29조 제8항).
7. **하위 처리자/제3자**: Google LLC, Stripe, Microsoft, MS Azure(데이터 저장), Hotjar, Amplitude, Slashpage.
8. **국외 이전**: 미국(Google/Stripe/Microsoft), 저장은 MS Azure. 이용자는 거부 가능하나 해당 서비스 이용이 제한될 수 있음.
9. **금지 행위**: 음란·폭력·혐오 콘텐츠, 정치적 이용, 무단 상업적 이용, 저작권 침해, 무단 재판매 등 금지(약관 제22조).

## 3. 우리(베일런/알람톡) 문서에 반영한 결정

- **개인정보처리자**: 베일런(Vailen), 대표 김규원 — `[[project_business_identity]]` 기준. (상세는 사업자등록증)
- **AI 학습**: "**학습 허용으로 고지**" 결정(2026-06-19). 기존 "범용 AI 학습 미사용" 약속은
  "베일런이 직접 운영하는 별도 학습에는 미사용 + 음성 수탁사(Perso)는 자사 정책에 따라 학습 이용 가능,
  이용자는 거부 가능(거부 시 기능 제한)"으로 대체. (privacy-policy §1.3·§2·§5·§6, terms §8,
  consent-and-permission-copy §2, store-disclosures 반영 완료)
- **위탁/국외이전 표**: ElevenLabs 행을 Perso(이스트소프트) 행으로 교체. 처리 항목에 음성/문구/생성음성/음성특성,
  목적에 음성 클론·TTS·서비스 개선·AI 학습, 이전국가 대한민국·미국 등 반영.
- **하위 처리자 고지**: 처리방침 §5에 Perso의 하위 처리자(Google, Microsoft/Azure 등)·국외이전 문단 추가.

## 4. 출시 전 Perso와 계약(서비스 계약/DPA)에서 반드시 확정할 사항 — 체크리스트

- [ ] **계약 형태 확인**: 우리가 쓰는 것이 Perso 소비자용 SaaS 약관인지, 별도 B2B/API 계약인지.
      B2B 계약이면 위 소비자 약관(특히 AI 학습 조항)과 다를 수 있으므로 **실제 적용 약관 기준으로 본 문서·처리방침을 재확정**.
- [ ] **수탁 처리 위탁계약(DPA)**: 개인정보보호법 제26조에 따른 위탁계약서 체결(처리 목적·범위·재위탁·안전성 확보·관리감독·손해배상).
- [ ] **AI 학습 옵트아웃 가능 여부와 기본값**: 베일런 이용자 음성을 학습에서 제외(opt-out)할 수 있는지, 그 경우 기능 제한 범위.
      만약 학습 제외가 가능하고 우리가 선택한다면, 처리방침의 "학습 허용 고지"를 "학습 미사용"으로 되돌릴지 재검토.
- [ ] **생체정보 처리**: 국내 음성=생체정보 해당 여부(런칭 관할 기준) 및 Perso의 암호화·분리저장·파기 절차 문서 확보.
- [ ] **국외 이전 고지·동의**: Perso가 미국(Google/Microsoft) 등으로 이전하는 점을 처리방침에 명시(반영 완료) + 앱 동의 문구 반영(반영 완료).
- [ ] **하위 처리자 목록·변경 통지**: Perso 하위 처리자 변경 시 통지받는 조항.
- [ ] **삭제 연동**: 알람톡 계정/음성 삭제 요청 시 Perso 측 음성ID·원본·생성물도 삭제되는지(API/계약상 보장). 1년 미사용 자동삭제 정책이 우리 보유정책과 충돌하지 않는지.
- [ ] **데이터 위치/리전**: 저장 리전(MS Azure) 및 한국 리전 사용 가능 여부.
- [ ] **보안·인증**: ISMS/ISO27001 등 인증, 사고 통지 SLA.

## 4-A. W2/W3 반영 사항 (서버 동의 강제 · 삭제 완전성 · 정책 버전)

- **서버측 동의 강제(W2)**: 동의 유형이 `packages/backend/src/lib/consent.ts`로 단일화되어
  `voice_biometric`(음성 생체정보), `overseas_transfer`(국외 이전)가 서버에서 enforce 된다.
  음성 클론 라우트(`POST /voice-profile/clone`)는 `voice_biometric` 미동의 시 403(CONSENT_REQUIRED)으로
  차단한다(코드: `voice-profile.ts`의 `needsConsent(db, userPk, ['voice_biometric'])`). 일반 필수 동의는
  `age14`/`terms`/`privacy` 3종(`GENERAL_REQUIRED_CONSENTS`).
- **음성 = 민감정보/생체정보 분류 확정(W3)**: 처리방침 §1.3·§6, 약관 제8조, 동의문구 §2, 스토어 고지를
  생체정보 분류 및 별도 동의 기준으로 정정 반영했다. Perso는 운영(production) 음성 클론·TTS 수탁사로 유지한다.
- **삭제 완전성(W3 확인)**: 계정 영구파기(`packages/backend/src/lib/account-deletion.ts`)는 (1) 행 삭제 *전에*
  `enqueueUserVoiceArtifacts`로 클론 음성·R2 오디오의 외부(수탁사/R2) 삭제 참조를 큐에 적재하고, (2) `userPk`가
  미해석인데 사용자 행이 실제 존재하면 throw 하여 자식 PII(클론 음성·결제·노트)가 고아로 남지 않게 한다(롤백 유도).
  실제 외부 삭제는 cron의 `drainExternalDeletions`가 수행한다. → 출시 전 Perso 측 음성ID/원본/생성물 삭제가
  계약/API로 보장되는지 §4 체크리스트 항목으로 재확인 필요(아래 미확정).
- **정책 버전 동기화(W3)**: `CURRENT_POLICY_VERSION`을 `'1' → '2'`로 상향(2026-06-22). 처리방침·약관의
  "최종 개정일 2026-06-22 / 정책 버전 2"와 일치. 기존 가입자 재동의 유도.

## 5. 코드 전환 메모 (법무 외)

음성 제공자 추상화는 `packages/backend/src/lib/voice-provider.ts`에 있으나 식별자·환경변수가
`elevenlabs_voice_id` / `ELEVENLABS_API_KEY` / `ElevenLabsClient`로 ElevenLabs에 결합되어 있다.
Perso 추가 시 provider 식별자 일반화(`provider` + `provider_voice_id`)와 DB 마이그레이션이 필요하다.
상세 전환 난이도·변경 지점은 실서비스 준비도 점검 리포트(voice-media 영역) 참조.

## 출처
- Perso 개인정보처리방침(영문, 시행 2025-10-31): https://info.perso.ai/policy-perso-saas/policy/privacy-policy-en/docs/251106.html
- Perso 이용약관(영문, 2025-06-26): https://info.perso.ai/policy_perso_saas/policy/terms-of-service_en/docs/250626_en.html
- 운영사 이스트소프트(ESTsoft) — 한국 소재. 문의 perso.info@estsoft.com / 1544-8209.
- 개인정보보호법 제26조(업무위탁에 따른 개인정보의 처리 제한), 제28조의8(국외 이전).
