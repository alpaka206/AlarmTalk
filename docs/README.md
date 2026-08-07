# 문서

목소리 알람 앱 **AlarmTalk** 의 저장소 문서. 기여자·개발자용이며, 외부 문서 시스템 없이 이 폴더만으로 완결된다.


## ⭐ 동작 스펙 (`spec/`) — 세 구현의 단일 출처

안드로이드·iOS·백엔드가 **같이 보는** 동작 규칙. 구현이 다르면 구현이 틀린 것이다.
동작을 바꾸려면 여기를 먼저 고친다. → [`spec/README.md`](spec/README.md)

## 목차

| 위치 | 내용 |
|---|---|
| **[spec/](spec/README.md)** | **⭐ 동작 스펙 — 세 구현의 단일 출처. 동작을 바꾸면 여기부터** |
| [product/](product/README.md) | 제품 방향, 대상 사용자, 음성 프롬프트 설계 |
| [tech/](tech/README.md) | 시스템 구조, DB 운영 규약, API 개요 |
| [standards/](standards/README.md) | 코딩 컨벤션, git 워크플로, 아키텍처 결정 |
| [qa/](qa/README.md) | 테스트 전략과 진행 중인 실기기 검증 |
| [manual/](manual/README.md) | 사용자 매뉴얼 (en · ko · ja) |
| [legal/](legal/README.md) | 개인정보처리방침, 이용약관, 동의 문구, 스토어 고지 |
| [ops/environments.md](ops/environments.md) | 환경 분리, 배포 설정, 릴리스 운영 |
| [reference/error-codes.md](reference/error-codes.md) | 백엔드 `error_code` 레퍼런스 |

## 규약

- 폴더마다 `README.md` 하나로 그 주제를 다룬다.
- 문서는 한국어로 쓴다. 번역본이 필요하면 같은 위치에 `README.ko.md` · `README.ja.md` 를 둔다.
- 코드와 어긋나면 코드가 이긴다. 코드에서 바로 읽히는 내용을 문서로 옮겨 적지 말고 코드를 가리켜라.
