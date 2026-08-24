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
  단, **공개되는 처리방침·약관 본문에는 상수명·파일 경로·테이블명 같은 구현 세부를 쓰지 않는다.**
  머리말은 `정책 버전: 4` 처럼 버전만 적고, 코드와의 동기화 규약은 이 문서에서 관리한다.
- **재동의는 내용이 바뀐 동의 유형만 받는다.** 정책 버전을 올려도 전 유형이 한꺼번에 만료되지
  않는다. 재동의 여부는 유형별 최소 정책 버전(`packages/backend/src/lib/consent.ts` 의
  `CONSENT_MIN_POLICY_VERSION`)으로 정하며, 개정이 **그 유형의 동의 내용을 실제로 바꿨을 때만**
  해당 유형의 최소 버전을 올린다. 수집·제공 범위를 줄이기만 한 축소 개정(예: 버전 4)은 기존
  동의 범위 안에 들어오므로 재동의 사유가 아니다 — 어느 유형의 최소 버전도 올리지 않는다.
  전 유형 만료는 실제 피해를 만든다: 모든 유형이 동시에 만료되면 이용자가 동의 화면 전체를
  다시 타고, 그 과정에서 켜 두었던 선택 동의(마케팅)가 초기화되어 꺼질 수 있다.
  같은 이유로 **클라이언트는 화면에 실제로 띄운 유형만 제출한다** — 띄우지 않은 유형의 기존
  동의 기록은 건드리지 않는다.
- **가입 화면에는 필수 4종과 선택 2종을 구분해 노출한다.** 필수는 만 14세·이용약관·
  개인정보 처리방침·국외 이전이고, 음성 생체정보와 마케팅은 선택이다. 음성 생체정보를
  거절한 사용자는 목소리를 만들려는 시점에만 다시 묻는다. 미들웨어의 앱 전체 하드 게이트와
  음성/TTS 라우트의 민감 동의 게이트는 별도다. 근거는
  [`compliance-notes.ko.md`](compliance-notes.ko.md) §1·§8, 화면 카피는
  [`consent-and-permission-copy.ko.md`](consent-and-permission-copy.ko.md)를 따른다.
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
