# 추가 음성팩 — 권리를 확인한 **고정 목소리**

> **단일 출처.** 구현이 이것과 다르면 구현이 틀린 것이다. → [README](README.md)

v1.3 지시서 12.4(2026-10-26). 기본 목소리 4종 밖의 목소리를 **권리를 확인한 고정 클립 묶음**으로 더한다.
사람이 녹음했거나 권리를 산 목소리의 테마 클립을 우리가 모아 올리고, 사용자는 마음에 드는 팩만 받아 알람에 쓴다.

## 0. 지금 상태 — **외부 권리/음원 대기**

⚠ **첫 팩의 권리 계약과 실제 음원이 아직 없다.** 그래서 이번 회차는 카탈로그·검수·게시·다운로드·알람 선택까지
**기능만** 만들었다. 운영 DB 에 게시된 팩은 0개이고, 앱의 '추가 팩' 섹션은 빈 상태를 그린다.

- **가짜 팩을 게시하지 않는다.** 시드·마이그레이션에 팩 행을 넣지 않는다. 테스트 fixture 는 테스트 DB 안에만 있다.
- 실음원이 없는 팩으로 '운영 완료' 를 표시하지 않는다 — 첫 팩이 게시되기 전까지 이 절을 지우지 않는다.
- 오너가 채울 것: 첫 팩의 계약(증빙 위치·기간·허용 문구·허용 지역·기존 파일 이용 조건)과 음원 폴더. 올리는 길은 §6.

## 1. 팩은 무엇이고, 무엇이 **아닌가**

| 팩은 | 팩은 아니다 |
| --- | --- |
| **무료 고정 콘텐츠.** 무료·플러스 모두 같은 팩을 같은 조건으로 받는다 | 새 과금 상품. 팩을 사거나 코드로 여는 길이 없다(AGENTS.md P1 — 코드로 유료 기능을 열지 않는다) |
| 미리 녹음한 **테마 클립**(날씨·운세·응원·약)과 미리듣기 인사말 | 그 화자로 아무 문장이나 말하게 하는 권한. **직접 입력을 그 목소리로 합성하지 않는다** |
| 기본 목소리 4종 **옆에** 더하는 것 | 기본 4종의 대체. 기본 4종은 언제나 남고, 선다운로드·알람 설정 관문도 그대로 기본 4종만 본다 |
| 플러스의 개인 목소리 슬롯과 **별개** | 개인 목소리 슬롯. 팩은 슬롯을 차지하지 않고, 팩을 받아도 등록할 수 있는 목소리 수가 줄지 않는다 |
| 우리가 올린 클립 | 다른 사람의 개인 클론. **개인 클론 공유·원격 알람을 되살리지 않는다**(AGENTS.md P1). 기존 유료·개인 클론을 팩으로 옮기는 경로가 없다 — 팩 클립은 관리자 가져오기(§6)로만 들어온다 |

그래서 **팩 목소리는 목소리 프로필이 아니다.** 서버 `voice_profiles` 에 행이 없고, 팩마다 `voice_id`
(`70000000-0000-4000-9100-` 로 시작하는 UUID — 기본 목소리 `…-9000-` 와 다른 대역)를 따로 둔다. 그 결과:

- `POST /tts/generate`·목소리 등록·사전렌더는 그 id 를 모른다 — 직접 입력 합성은 구조적으로 불가능하다(404).
- 앱은 **서버 알람 사본에 팩 목소리·팩 클립 id 를 싣지 않는다.** 그 알람은 `voice_profile_id`·`message_id` 를 비우고
  `mode = 'sound-only'` 로, 테마(`bucket_id`)만 보낸다(`clears_missing_voice_references = true`). 서버 행은 사본이고
  pull·복구가 없으므로(`alarm-lifecycle.md`) 잃는 것이 없다.
- 플러스 판정·목소리 접근권 대조(`VoiceAccessSyncWorker` 등)는 팩 목소리를 **보지 않는다** — 목록(`GET /voice`)에
  없다는 이유로 팩 알람을 '접근권 상실' 로 강등하면 안 된다.

## 2. 팩의 구조 — **기본 목소리와 같은 모양**이어야 게시된다

편집기·울림·회전·조건 클립 고르기는 기본 목소리의 것을 그대로 쓴다. 그래서 팩은 기본 목소리와 같은 클립 구조를 갖춰야
게시된다(§4 게시 조건):

- **언어 하나.** 팩의 모든 클립은 그 언어다. 앱 언어와 달라도 고를 수 있고 그 언어로 운다(클론과 같다). 기기 언어를
  바꿔도 다시 묶지 않는다.
- **알람 테마 넷이 다 있다** — `weather`·`fortune`·`cheer`·`medication`, 각 테마의 variant 는 기본 목소리 매니페스트의
  개수(`GET /tts/stock-clips` 의 `expected_variants.system`)와 같은 0..N-1. 날씨·운세는 **절대 인덱스**로 조건을 고르므로
  variant i 는 기본 목소리 variant i 와 **같은 조건**을 말해야 한다(검수 항목).
- **미리듣기 샘플** = `greeting` variant 0 하나. 알람 테마가 아니다.
- 직접 입력·기본 인사말(`preset`)은 팩 목소리로 고를 수 없다(편집기가 그 두 항목을 감춘다).

⚠ 테마 일부만 허락하는 계약이 오면 이 규칙으로는 게시할 수 없다. 그때는 편집기가 팩별로 고를 수 있는 테마를 거르는
일을 먼저 하고 이 절을 고친다 — 부분 세트를 그냥 게시하면 고를 수는 있는데 소리가 없는 알람이 생긴다.

## 3. 카탈로그 — 무엇을 갖고, **무엇을 내려주지 않는가**

| 값 | 내용 | 앱 API |
| --- | --- | --- |
| `pack_id` | 영소문자·숫자·하이픈 3~40자. 바뀌지 않는다 | ✅ |
| `voice_id` | 위 §1 의 UUID. 알람 행이 이걸 든다 | ✅ |
| `content_revision` | 클립을 더하거나 바꿀 때마다 1씩 오른다. 앱은 이게 바뀌면 상세를 다시 받는다 | ✅ |
| 화자 표시 `speaker_name`·소개 `description`·사용 범위 `usage_note` | 화면에 그대로 나간다(줄표 금지) | ✅ |
| `language` | ko·en·ja | ✅ |
| 클립 | `clip_id`(UUID)·테마·variant·문구·`sha256`·`size_bytes`·형식 | ✅(상세) |
| 최소 앱 빌드 `min_android_build`·`min_ios_build` | 이보다 낮은 빌드에는 목록·상세·오디오 모두 없다 | ❌(걸러서 적용) |
| 권리 상태 `rights_status` | pending·verified·expired·revoked | ❌ |
| **증빙 위치** `rights_evidence_ref` | 계약서가 있는 내부 위치(드라이브 경로 등). **원문은 서버에 올리지 않는다** | ❌ |
| 기간 `rights_valid_from`~`rights_valid_until` | 이 밖에서는 게시돼도 내려가지 않는다 | ❌ |
| 허용 문구 `rights_allowed_text` | 계약이 허락한 문구 범위의 메모 | ❌ |
| 허용 지역 `rights_allowed_regions` | 나라 코드 목록, `*` = 전 세계 | ❌(걸러서 적용) |
| 기존 파일 이용 조건 `existing_file_terms` | §5 | ❌(`playback_until` 로만 나간다) |
| 게시 상태 `status` | draft·review·published·suspended | ❌(목록 포함 여부로만 드러난다) |

⚠ **권리 메타데이터는 일반 앱 API 로 한 글자도 내려가지 않는다.** 응답은 공개 필드 화이트리스트(`toPublicPack`)로만
만든다 — 행을 통째로 직렬화하지 말 것. 회귀 테스트가 응답 본문에 권리 필드 이름·증빙 문자열이 없음을 고정한다.

### 앱 API(로그인 필요)

| 요청 | 답 |
| --- | --- |
| `GET /api/voice-packs` | `packs`: 지금 받을 수 있는 팩 요약(미리듣기 샘플 `clip_id`·크기, 클립 수, 전체 바이트) · `withdrawn`: 게시가 끝난 팩의 `pack_id`·`voice_id`·`playback_until` |
| `GET /api/voice-packs/:packId` | `pack`: 요약 + `clips`(다운로드 상태를 셀 목록) |
| `GET /api/voice-packs/:packId/clips/:clipId/audio` | `audio_base64`·`audio_format`·`sha256`·`size_bytes` |

- **'지금 받을 수 있다'** = `published` + 권리 `verified` + 기간 안 + 요청 나라가 허용 지역 + 요청 빌드가 최소 빌드 이상.
  하나라도 아니면 상세·오디오는 `404 VOICE_PACK_NOT_FOUND` 다(비게시 팩이 있다는 사실도 드러내지 않는다).
  나라는 Cloudflare 의 `CF-IPCountry`, 빌드는 `X-App-Platform`·`X-App-Version` 이다. 헤더가 없으면 받을 수 없다.
- **IDOR**: 클립은 **그 팩의 클립**이어야 한다. 다른 팩(비게시 포함)의 `clip_id` 를 붙이면 `404 VOICE_PACK_CLIP_NOT_FOUND`.
  팩은 계정 소유물이 아니라 누구에게나 같은 콘텐츠이므로 계정 대조는 없다 — 게이트는 게시 상태 하나다.
- 오디오는 기본 목소리 클립과 같은 내려받기 버킷(분당 600)을 쓴다. 플랜을 보지 않는다(무료 고정 콘텐츠).
- `withdrawn` 에는 **한 번이라도 게시된** 팩만 든다. draft·review 는 어디에도 나오지 않는다.

## 4. 게시 상태와 검수

```
draft ──검수 요청──▶ review ──게시──▶ published ──게시 중단──▶ suspended
  ▲                    │                  ▲                       │  │
  └──────반려──────────┘                  └──────다시 게시────────┘  │
  ▲                                                                  │
  └──────────────────────고치려고 draft 로────────────────────────────┘
```

- 게시를 끝낸 팩을 고치려면 '고치려고 draft 로' 를 한다. 그 팩은 다시 검수·게시될 때까지 앱에 **계속 '게시 끝남'** 으로
  보인다(한 번이라도 게시된 팩이 게시 중이 아니면 `withdrawn` 에 든다 — 기준 시각은 중단 시각).

- **클립을 바꾸는 것은 draft 에서만**이다(가져오기·교체·삭제). 바꿀 때마다 `content_revision` 이 오르고, 같은 자리를
  바꾸면 새 `clip_id` 가 난다 — 앱은 id 로 받으므로 옛 파일과 섞이지 않는다.
- **게시 조건**(서버가 막는다, 화면은 남은 항목을 보여 준다): 권리 `verified` · 증빙 위치 · 기간이 지금을 포함 · 허용 문구 ·
  허용 지역 · 이용 조건(`until_date` 면 날짜) · 화자 표시 · 미리듣기 샘플 · §2 의 테마 넷 완전 세트.
- 게시 중인 팩의 권리를 고칠 때도 같은 조건을 다시 본다 — 고친 값으로 조건이 깨지면 고치지 않는다(먼저 중단한다).
- 권리 기간이 끝나면 상태가 `published` 로 남아 있어도 **그 순간부터 중단과 같이** 다룬다(§5, 기준 시각 = 기간 끝).
- 모든 쓰기(만들기·클립·권리·전이)는 **감사 기록**(`voice_pack_events`)에 행 하나를 남긴다 — 무엇을, 어느 상태에서
  어느 상태로, 메모. 콘솔은 비밀번호 하나라 사람을 가를 수 없어 지급과 같이 `admin-console`(스크립트는 `admin-script`)로 적는다.
- 게시·중단은 확인 체크를 해야 보낸다(콘솔). 되돌릴 수는 있지만(다시 게시), 앱은 중단을 본 순간 안내를 띄운다.

## 5. 게시가 끝나면 — **기존 알람을 곧바로 무음으로 만들지 않는다**

게시 중단(또는 권리 기간 끝)은 **새로 받기**를 막는 것이지 이미 받은 알람을 끄는 것이 아니다. 계약이 허락한 기존 재생
범위와 기간 안에서는 그대로 운다. 서버가 그 기한을 계산해 `withdrawn[].playback_until` 로 알린다.

| `existing_file_terms` | 기존 알람이 그 팩으로 울 수 있는 기한 |
| --- | --- |
| `stop_on_suspend` | 중단 시각(곧바로 대체) |
| `until_rights_end` | 권리 기간 끝 |
| `until_date` | 지정한 날(`existing_playback_until`) |

어느 경우든 권리 기간 끝을 넘지 않는다. 권리가 `revoked` 면 중단 시각이다.

앱은:

1. **카탈로그에서 뺀다.** 새로 받기·편집기 새 선택이 사라진다. 이미 그 팩 목소리로 저장된 알람은 편집기에서 그대로
   보이고 저장된다(목소리를 바꾸지 않는 편집).
2. **기한 전에는 안내만 한다** — 목소리 탭 '추가 팩' 의 그 팩 행에 "게시가 끝났어요 · M월 D일까지 기존 알람에서 울려요".
3. **기한이 지나면 대체한다** — 그 팩 목소리 알람을 **기본 목소리 미나**로 바꾸고(같은 테마의 미나 클립을 묶는다 —
   `billing-lifecycle.md` 「목소리를 못 쓰게 되면」 과 같은 모양·같은 대체 목소리), 팩 파일을 지우고, 받은 팩 목록에서 뺀다.
   미나 클립은 기본 4종 선다운로드로 이미 폰에 있다.
4. 대체는 **앱이 돌 때** 한다(앱 시작·전경 복귀·선다운로드 회차). 기한은 받아 둔 값으로 기기에서 판정하므로
   그때 네트워크가 없어도 된다. 전경 복귀는 **어느 탭으로 돌아오든** 본다 — 목소리 탭 진입이나 세션 변화를 기다리지
   않는다(기한은 백그라운드에 있는 동안에도 지난다). ⚠ **울림 경로는 날짜도 네트워크도 보지 않는다** — 그래서 기한 뒤 앱을 한 번도 열지
   않은 기기는 다음 실행까지 팩 파일로 운다(알고 두는 창이다. iOS 는 AlarmKit 예약에 소리가 이미 박혀 울릴 때 바꿀
   수도 없다).
5. 목록에 팩이 **아예 없으면**(최소 빌드를 올렸거나 다른 나라에서 접속) 아무것도 하지 않는다 — 대체는 `withdrawn` 에
   명시된 팩에만 한다.

## 6. 관리자

`/admin/voice-packs`(목록) · `/admin/voice-packs/:packId`(상세). 관리자 콘솔의 인증·CSRF·nonce 를 그대로 쓴다
([`admin-console.md`](admin-console.md)).

- **가져오기는 스크립트로 한다** — `packages/backend/scripts/import-voice-pack.ts <폴더>`. 폴더의 `pack.json`(메타·클립 목록)과
  오디오 파일을 읽어 `POST /admin/voice-packs/import`(메타)·`POST /admin/voice-packs/:packId/clips`(클립 하나씩, base64)로
  올린다. 서버가 해시·크기를 직접 계산하고 R2 `voice-packs/<packId>/<clipId>.<ext>` 에 둔다. 클립 하나 2MB, mp3·m4a·wav.
  draft 일 때만 받는다. 비밀번호는 환경변수 `ADMIN_SECRET`(Basic)로, 출처는 그 콘솔 주소(`Origin`)로 보낸다.
- 상세 화면: 공개 정보 · 권리(내부) 편집 · 클립 표(들어 보기·해시·크기) · 남은 게시 조건 · 전이 버튼 · 감사 기록.
- 화면 글자에 줄표를 쓰지 않는다. 콘솔의 다른 화면과 같은 토큰·컴포넌트다.

## 7. 앱

### 목소리 탭 '추가 팩' 섹션

- 기본 목소리 섹션 **아래**. 팩이 하나도 없으면 빈 상태 한 줄("준비 중인 추가 팩이 아직 없어요").
- 행: 화자 표시 · 언어 · 크기 · 상태(받기 전 / 받는 중 N% / 받음 / 게시 끝남 안내). 누르면 **팩 상세**.
- **팩 상세**(지시서 7.2): 미리듣기 샘플 재생 · 사용 범위(`usage_note`) · 크기와 다운로드 상태 · **실제 적용 대상 설명**
  ("받으면 알람 목소리 목록에 이 목소리가 생겨요. 날씨·운세·응원·약 테마에 쓸 수 있고, 직접 입력에는 쓸 수 없어요.
  이미 있는 알람은 바뀌지 않아요.") · 받기 / 지우기.
- 미리듣기 샘플은 받기 전에도 들을 수 있다 — 샘플 클립 하나만 받아 캐시한다(팩 전체를 받지 않는다).
- 미리듣기는 **한 번에 하나만** 운다 — 팩 샘플을 틀면 기본·클론 미리듣기가 멈추고, 반대도 같다(안드로이드는 미리듣기
  플레이어가 하나다).
- **지우기**: 그 팩 목소리를 쓰는 알람이 있으면 먼저 묻는다("알람 N개가 미나 목소리로 바뀌어요"). 확인하면 §5-3 과 같은
  대체를 곧바로 하고 파일을 지운다.

### 받기 — **고른 팩만**, 기본 목소리 **다음에**

- 팩은 사용자가 상세에서 '받기' 를 누른 경우에만 받는다. 첫 기본 다운로드 관문(받기 화면·알람 설정 관문)에 넣지 않는다 —
  그 관문은 계속 기본 4종만 센다.
- 받는 작업은 **기존 선다운로드를 확장한다**(안드로이드 `StockClipPrefetchWorker`, iOS `StockClipPrefetcher`) — 새 워커를
  만들지 않는다. 한 회차 안의 순서는 기본 목소리·내 클론(지시서 7.3 의 1~3번과 4번의 기본 목소리) **뒤**에 받은 팩
  (4번의 '선택한 추가 팩')이다. 받기를 누르면 그 회차를 깨운다.
- 받은 팩마다 상세(클립 목록)를 기기에 적어 둔다 — 오프라인에서도 편집기가 고를 수 있어야 하고, 무엇이 빠졌는지 셀 수
  있어야 한다. `content_revision` 이 바뀌면 상세를 다시 받고 **빠지거나 해시가 다른 클립만** 받는다.
- 받은 바이트는 **해시(sha256)와 크기를 대조**하고 맞을 때만 캐시에 넣는다. 캐시 키는 `pack_<clipId>` — 기본 목소리의
  `stock_` 네임스페이스와 따로 둔다(기본 목소리 매니페스트 기준 정리가 팩 파일을 지우지 않게, 오래된 캐시 정리도 `pack_`
  을 건너뛴다).
- 다 받았을 때만 '받음' 이고, 그때부터 편집기에 나온다. 일부 실패는 같은 회차·다음 회차가 이어 받는다.
  - 개정이 바뀌어 상세(클립 목록)를 새로 적으면 다시 **받는 중**이다 — 새 클립을 다 받아 대조할 때까지 '받음' 이 아니고,
    받다가 실패해도 '받음' 으로 남지 않는다. 빠진 클립이 남은 회차의 끝도 같다.
  - 상세를 기다리는 사이 사용자가 팩을 지웠으면 **되살리지 않는다**(다시 받지도 않는다). 그 사이 다른 받기가 개정을
    바꿨으면 그쪽을 둔다.
- **받은 팩의 클립 파일은 팩이 쥔다** — 그 팩 목소리로 만든 알람을 지워도, 목소리 강등이 그 알람의 클립을 놓아도 지우지 않는다
  (지우면 팩은 '받음' 인데 파일이 없어 오프라인 저장이 실패한다). 팩 파일을 놓는 것은 팩 지우기·개정 정리·기한 대체뿐이고,
  그때도 이 기기의 **다른 계정**이 같은 팩을 받아 두었으면 남긴다.
- 개정이 바뀌어 클립 id 가 바뀌면 **이미 저장한 알람은 묶은 클립 그대로 운다**(다시 저장하면 새 클립을 묶는다). 놓은 옛 클립
  파일은 어떤 알람도 안 쓸 때만 지운다.
- 카탈로그에 없는 팩(최소 빌드·허용 지역)은 받으려 하지 않는다 — 서버가 404 로 답한다. 받아 둔 파일·알람은 그대로 둔다.
- 로그아웃·계정 전환: 받은 팩 목록은 계정별이다. 파일은 기기 캐시라 남지만(기본 목소리 클립과 같다) 다른 계정의
  목록에는 안 보인다.

### 편집기

- 다 받은 팩 목소리는 목소리 고르기 시트에 기본 목소리 **다음**에 나온다(설명 줄 '추가 팩').
- 지금 여는 알람이 이미 쓰는 팩은 게시가 끝났어도·새 개정을 받는 중이어도 그 알람의 목록에 남는다. 편집기를 열기만 해서
  목소리가 바뀌면 안 된다 — 목소리 목록 새로고침(서버 목록에는 팩이 없다)도 받은 팩 선택을 '지워진 목소리' 로 읽지 않는다.
- 고르면 기본 목소리처럼 테마 클립을 묶는다(§2). 직접 입력·기본 인사말 항목은 감춘다. 직접 입력 문구가 있는 알람에서
  팩 목소리로 바꾸면 그 문구를 버리고 직전 테마 선택(없으면 응원)으로 잇는다 — 바꾸기 전에 기본 목소리와 같은 확인
  알럿을 띄운다.
- 저장·울림은 기본 목소리 알람과 같다 — 클립은 이미 폰에 있으니 네트워크를 타지 않는다.

## 8. 오류 코드

`VOICE_PACK_NOT_FOUND`(404) · `VOICE_PACK_CLIP_NOT_FOUND`(404) — 앱이 받는다(문구 표 짝).
`ADMIN_VOICE_PACK_INVALID`(400) · `ADMIN_VOICE_PACK_NOT_FOUND`(404) · `ADMIN_VOICE_PACK_LOCKED`(409 — draft 가 아니라 클립을
못 바꾼다) — 가져오기 스크립트만 받는다.

## 9. 의도된 플랫폼 차이

- iOS 는 AlarmKit 예약에 소리 파일이 박힌다 — §5-3 의 대체 뒤에는 그 알람을 **다시 예약**해야 소리가 바뀐다(기본 목소리
  강등과 같은 경로).
- 안드로이드는 받는 동안 진행률이 기본 목소리 받기와 같은 알림에 섞이지 않는다 — 팩은 섹션 행의 퍼센트로만 보인다(받을
  것이 팩뿐인 회차에 포그라운드 서비스를 올리지 않는다).

## 남은 일

- **첫 팩**(외부 권리/음원 대기 — §0).
- 공개 캠페인 링크(지시서 12.4) — 팩 상세로 바로 여는 링크. 이번 회차에 만들지 않았다(딥링크 경로·랜딩 페이지가 필요하다).
- 테마 일부만 허락하는 계약 대응(§2 끝).

## 구현 지도

| 규칙 | 백엔드 | Android | iOS |
| --- | --- | --- | --- |
| 표·감사 기록 | 마이그레이션 #144(`voice_packs`·`voice_pack_clips`·`voice_pack_events`) | — | — |
| 받을 수 있는가(게시·권리·지역·빌드) | `lib/voice-packs.ts` 의 `packListable` | — | — |
| 기존 재생 기한 | `lib/voice-packs.ts` 의 `withdrawnPlaybackUntil` | — | — |
| 권리 메타데이터 비노출 | `lib/voice-packs.ts` 의 `toPublicPack` | — | — |
| 게시 조건 | `lib/voice-packs.ts` 의 `publishBlockers` | — | — |
| 앱 API | `routes/voice-packs.ts` | `network/VoicePackApi.kt` | `AlarmTalkAPI.swift` 의 `getVoicePacks`·`getVoicePack`·`getVoicePackClipAudio`(모델은 `VoicePacks.swift`) |
| 관리자 화면·전이·가져오기 | `routes/admin.ts`·`lib/admin/voice-pack-pages.ts`·`lib/voice-packs.ts` 의 `transitionVoicePack`·`importVoicePackClip`, `scripts/import-voice-pack.ts` | — | — |
| 팩 목소리 id 대역 | `lib/voice-packs.ts` 의 `VOICE_PACK_VOICE_ID_PREFIX` | `data/VoicePacks.kt` 의 `isVoicePackVoiceId` | `VoicePacks.swift` 의 `isVoicePackVoiceID` |
| 받은 팩 목록(계정별) | — | `data/VoicePackStore.kt` | `VoicePackStore.swift` 의 `activate(userID:)`(`AlarmTalkApp` 의 계정 키 태스크) |
| 받기(선다운로드 확장, 해시·크기 대조) | — | `sync/StockClipPrefetchWorker.kt` 의 `VoicePackDownloader` | `StockClipPrefetcher.start` 의 회차 끝 → `VoicePackStore.runDownloadStage`, `AudioCacheStore.cacheVoicePackClip` |
| 캐시 키 `pack_` | — | `data/VoicePacks.kt` 의 `voicePackCacheKey`, `AlarmAudioStore.sweepStaleCache` | `VoicePacks.cacheKey(clipID:)`·`StockClip.cacheKey`, `AudioCacheStore.sweepStaleCache` |
| 기한 뒤 미나로 대체·지우기 | — | `data/AlarmRepository.kt` 의 `degradeAlarmsUsingVoicePack` | `VoicePackStore.retireExpired`·`remove` → `VoiceStudioViewModel.degradeVoicePackAlarms` |
| 접근권 대조에서 팩 제외 | — | `AlarmRepository.degradeAlarmsWithInaccessibleVoice` | `VoiceStudioViewModel.reconcileInaccessibleVoiceAlarms` |
| 무료로 쓴다 | — | `data/SystemVoices.kt` 의 `usesFreeSystemVoiceAlarm` | `VoicePacks.swift` 의 `isFreeFixedVoiceID`(`PaidVoiceGate.usesFreeSystemVoice`·`LocalAlarmRecord.isPaidVoiceForDowngrade`·`isStockVoiceClip`) |
| 서버 사본에 팩 id 를 싣지 않는다 | — | `network/RemoteAlarmMapper.kt` | `RemoteAlarmMapper.swift` |
| 목소리 탭 '추가 팩'·팩 상세 | — | `ui/voices/VoicePackSection.kt` | `Views/Voices/VoicePackSection.swift` |
| 받는 중으로 되돌리기·지운 팩 되살리지 않기 | — | `data/VoicePacks.kt` 의 `HeldVoicePack.fromDetail`, `sync/StockClipPrefetchWorker.kt` 의 `refreshDetailIfNeeded`·`downloadPack` | `VoicePacks.held(from:previous:)`, `VoicePackStore.adoptRevisedDetail`·`finishDownload` |
| 개정에서 빠진 옛 클립 파일 지우기(알람이 안 쓸 때만) | — | `sync/StockClipPrefetchWorker.kt` 의 `refreshDetailIfNeeded` → `releaseUnusedAudio` | `VoicePackStore.adoptRevisedDetail` → `releaseUnreferencedClips` |
| 전경 복귀마다 기한 지난 팩 대체(네트워크 없이) | — | `ui/main/MainViewModel.kt` 의 진입 구독(`AppSignals.appEntries`) → `MainViewModelVoicePacks.kt` 의 `retireDueVoicePacksOnEntry` | `AlarmTalkApp.swift` 의 전경 복귀(`.active`) → `VoicePackStore.retireExpired` |
| 받은 팩 클립은 일반 알람 정리가 지우지 않는다 | — | `data/VoicePackStore.kt` 의 `heldClipCacheKeysOnDevice`, `AlarmRepository.deleteAlarmLocked`·`deleteAudioNoAlarmUses` | `VoicePackStore.heldClipCacheKeysOnDevice`, `AlarmKitViewModel.deleteLocalAlarm`·`VoiceStudioViewModel.degrade`·`VoicePackStore.remove` |
| 미리듣기는 한 번에 하나 | — | `ui/voices/VoiceProfileManagementPanel.kt` 의 `playVoicePackSample`(같은 미리듣기 플레이어) | `AudioPreviewPlayer.play`(다른 플레이어를 끊는다) |
| 새로고침이 팩 선택을 지우지 않는다 | — | `data/VoicePacks.kt` 의 `editorVoicePacks` | `VoiceStudioViewModel.selectionSurvivesRefresh`, `VoicePacks.editorEntries` |
| 편집기 목록·직접 입력 감추기 | — | `ui/app/AlarmTalkApp.kt` 의 편집기 라우트(`editorVoicePacks` 로 합치기)·`ui/editor/AlarmRandomPromptSettings.kt` 의 `manualAvailable`·`ui/editor/AlarmEditorScreen.kt` 의 `fixedVoiceClipLanguage`·저장 막기 | `Views/Editor/AlarmEditorSheet.swift` 의 `editorProfiles`·`editorStockClips`·`applyVoiceSelection`, `MessageSettingsPane.manualAvailable` |
| 언어 재바인딩에서 팩 제외 | — | `sync/StockClipLanguageRebinder.kt` 의 `needsRebind` | `StockClipLanguageRebinder.needsRebind` |
| 카탈로그 조회·받기 시작·지우기·샘플 | — | `ui/main/MainViewModelVoicePacks.kt` | `VoicePackStore.swift` |
| 테스트 | `test/voice-packs.test.ts` | `data/VoicePackTest.kt`·`sync/VoicePackDownloaderTest.kt` | `AlarmTalkTests/VoicePackTests.swift` |
