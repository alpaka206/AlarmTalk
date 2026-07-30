# 법무 / 개인정보 문서

알람톡(AlarmTalk)의 법무·개인정보 문서 모음이다. 한국 출시, Android 단일 플랫폼 기준으로 쓰여 있다.
법률 자문을 대체하지 않는다 — 출시 전 법무 검토를 권장한다.

## 파일

| 파일 | 성격 |
| --- | --- |
| [`privacy-policy.ko.md`](privacy-policy.ko.md) | 개인정보 처리방침 **본문** |
| [`terms-of-service.ko.md`](terms-of-service.ko.md) | 서비스 이용약관 **본문** |
| [`marketing-consent.ko.md`](marketing-consent.ko.md) | 마케팅 수신 동의(선택) 상세 문안 |
| [`consent-and-permission-copy.ko.md`](consent-and-permission-copy.ko.md) | 앱 내 동의·권한 요청 화면 카피 |
| [`store-disclosures.ko.md`](store-disclosures.ko.md) | Google Play 제출(Data safety) 체크리스트 |
| [`compliance-notes.ko.md`](compliance-notes.ko.md) | 각 결정의 법령 근거와 판단 기록 |

## 이 문서들이 실제로 쓰이는 곳

- **`privacy-policy.ko.md` / `terms-of-service.ko.md` 는 랜딩 사이트가 빌드 시 그대로 읽어
  렌더한다**(`apps/landing/lib/legal-docs.ts` → `/ko/privacy`, `/ko/terms`).
  이 두 파일을 고치면 **공개 페이지 본문이 바뀐다.** 초안이 아니라 배포물로 다뤄야 한다.
- 나머지 4개는 앱·스토어 제출·내부 판단용 참고 문서이며 공개되지 않는다.

## 고칠 때 지킬 것

- **정책 버전은 코드가 단일 출처다.** `packages/backend/src/lib/consent.ts` 의
  `CURRENT_POLICY_VERSION` 과 처리방침·약관 머리말의 "정책 버전 / 최종 개정일" 을 함께 올린다.
  버전을 올리면 기존 가입자에게 재동의를 요구하므로, 중요한 개정에만 올린다.
- **실제 코드가 하는 일만 적는다.** 수집하지 않는 항목, 붙어 있지 않은 수탁사, 없는 기능을
  처리방침·약관에 적으면 그 자체가 허위 고지다. 고치기 전에 백엔드/앱 코드로 교차검증할 것.
- 사업자 정보(베일런·대표 김규원·사업자등록번호·주소·연락처)의 기준은
  [`privacy-policy.ko.md`](privacy-policy.ko.md) 머리말이다. 다른 문서는 이를 따라간다.

## 출시 전 확인 사항

- ElevenLabs 실제 적용 약관·DPA·retention 설정·하위 처리자 목록
  (근거와 배경은 [`compliance-notes.ko.md`](compliance-notes.ko.md) §7)
- Google Play Data safety 신고 내용이 실제 SDK·백엔드 동작과 일치하는지
  ([`store-disclosures.ko.md`](store-disclosures.ko.md))
- 유료 플랜을 직접 판매한다면 통신판매업 신고 여부
