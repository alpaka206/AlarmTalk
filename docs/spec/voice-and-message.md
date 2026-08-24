# 목소리와 문구

> **단일 출처.** 구현이 이것과 다르면 구현이 틀린 것이다. → [README](README.md)

## 1. 재생 방식은 **둘뿐**이다

**알람** / **목소리**. '알람 + 목소리' 를 되살리지 말 것.

- 안드로이드에서 그 모드는 톤이 울리고 **해제할 때** 목소리가 한 번 났는데, 알림을 밀어
  없애면 건너뛰었다. 목소리를 들으려면 알람을 꺼야 하는 구조라 발견 자체가 어려웠다.
- iOS 는 AlarmKit 에 넘길 사운드가 1개라 '톤 먼저, 목소리 나중' 이 구조적으로 불가능했다.
- 저장된 옛 값은 **목소리로 읽는다.** 그 모드를 고른 사람은 목소리를 만들어 둔
  사용자다 — 알람음으로 옮기면 애써 만든 목소리를 못 듣게 된다.

**목소리가 왼쪽이고 새 알람의 기본값이다.** 우리는 목소리 알람 앱이다. 읽는 순서와
기본 선택이 어긋나면 무엇이 기본인지 흐려진다.

**고른 쪽 박스만 그린다.** '알람' 이면 목소리 카드가 통째로 없고, '목소리' 면 세부설정의
알람음 행이 없다. 안 고른 쪽 설정을 남겨 두면 만질 수는 있는데 울릴 때 아무 영향이 없는
컨트롤이 된다.

## 2. 기본(시스템) 목소리 제한 — 판정은 **OR**

기본 목소리는 **미리 만들어 둔 클립만** 말할 수 있다. 그래서 문구를 무료 버킷
('날씨+약')으로 제한하는 조건은 플랜과 목소리 종류의 **OR** 다:

```
제한한다 = (무료 등급) || (시스템 목소리를 골랐다)
```

⚠ **`&&` 로 쓰면 유료 사용자가 기본 목소리에 직접 입력 문구를 붙일 수 있다** — 저장은
되는데 그 문구를 말할 방법이 없는 알람이 된다. iOS 가 실제로 `&&` 였다(2026-08-07 수정).

⚠ **한 곳만 고치지 말 것.** 이 플래그는 세 갈래에서 함께 읽힌다:
1. **렌더** — 문구 요약 행을 '무료 테마' 로 그릴지 '문구 선택' 으로 그릴지
2. **상태 강제** — 목소리 소스·랜덤 여부·컨텍스트를 preset 4-값으로 고정
3. **저장 검증** — 저장 직전 유효성

렌더만 맞추면 **보이는 대로 저장되지 않는** 상태가 된다.

⚠ **직접 녹음에는 이 제한을 걸지 않는다.** 녹음본은 그냥 로컬 오디오 재생이라 플랜·목소리
종류와 무관하게 허용된다. 상태 강제가 소스를 TTS 로 되돌리면 **녹음해 둔 것이 지워진다** —
특히 유료 사용자가 기본 목소리를 고른 채 녹음했을 때(선택 목소리 id 는 시스템인데 소스는
녹음) 제한이 걸려 녹음이 날아간다. 제한은 **소스가 TTS 일 때만** 적용한다.

⚠ **안내 문구도 상태마다 다르다.** 무료라서 막힌 것과 기본 목소리라서 막힌 것은 다른
사실이다 — 유료에게 "무료에서는…" 이라고 하면 거짓말이 된다.

## 3. 목소리를 바꿀 때 문구가 사라지면 **묻는다**

시스템 목소리로 바꾸는데 직접 입력 문구가 있으면 확인 모달을 띄운다
("기본 목소리로 바꿀까요?"). 조용히 지우면 '문구가 사라졌다' 가 된다.

판정식은 **`시스템목소리로바꿈 && 직접입력문구있음 && !랜덤 && !버킷`** 이다.
⚠ `!랜덤` 하나만 보면 안 된다 — 버킷이 붙으면 랜덤이 꺼지므로 버킷 알람까지 걸린다.

## 4. 편집기 기본값 = **직전 선택 유지**

새 알람의 목소리·문구 종류·무료 테마는 **하드코딩 기본값이 아니라 그 계정이 마지막에
고른 값**이다. "기본값으로 초기화" 로 되돌리는 변경은 전부 회귀다.

- **기록 시점은 알람 저장 성공 시 한 곳뿐.** 편집기에서 눌러만 보고 취소한 것은
  기억하지 않는다.
- **적용 대상은 새 알람뿐.** 기존 알람을 열 때는 저장된 자기 값만 쓴다.
- **목소리 프리셀렉트는 마지막에 쓴 것이 그룹보다 우선.** 그룹을 먼저 보면 클론을 가진
  사람이 기본 목소리를 골라 저장해도 매번 클론으로 되돌아간다.
- 이어받는 것은 **선택 값 하나**뿐이다. 회전 인덱스·클립 키는 알람별 상태라 따라가지 않는다.

### 무엇을 기억하고, 무엇을 건드리지 않는가

기억하는 축은 **셋이고 서로 섞이지 않는다**:

| 저장 키 | 무엇 | 언제 |
| --- | --- | --- |
| `last_message_context_<userId>` | 생성형 문구 종류 | 랜덤 문구로 저장했을 때 |
| `last_manual_text_<userId>` | 직접 입력 문구 | 직접 입력으로 저장했을 때 |
| `last_free_bucket_<userId>` | 무료 테마(버킷) | 스톡 클립으로 저장했을 때 |

⚠ **문구 개념이 없는 알람은 기록을 건드리지 않는다.** 알람 전용·녹음/파일 알람은
문구가 nil 인데, 가드 없이 내려가면 **직전에 기억해 둔 직접 입력 문구를 지운다.**
알람음 알람 하나 저장했다고 취향이 사라지면 안 된다.

⚠ **스톡 클립은 '직접 입력' 이 아니다.** 스톡은 고정 음원이라 `voiceRandomPrompt=false`
로 저장되는데, 그것만 보고 직접입력으로 떨어뜨리면 **서버 스톡 클립의 문장**이
'내가 친 문구' 로 기억된다 — 다음 새 알람이 직접 입력으로 열리고 테마는 매번 초기화된다.

상세(저장 키 이름, 버킷 판정식, 직접 입력 문구 기억)는 `CLAUDE.md`
「알람 편집기 기본값 = 직전 선택 유지」 절에 있다.

## 4-1. 목소리 등록은 **같은 5단계**다

안드로이드와 iOS 모두 `음원 준비 → 세부 정보 → 생성 중 → 미리듣기·확정 → 오프라인 준비`
순서로 진행한다. 한 긴 폼에 전부 펼치지 않는다 — 먼저 녹음을 끝낸 뒤 이름을 입력하고,
실제 클론이 생긴 뒤에 들어보고 유지 여부를 정해야 각 버튼이 지금 하는 일이 하나뿐이다.

| 단계 | 화면에 두는 것 | 다음 조건 |
| --- | --- | --- |
| 음원 준비 | 녹음/파일 2택, 녹음 카드 또는 파일 자르기·미리듣기, 접힌 예시 대본 | 12초 이상 2분 이하 음원 |
| 세부 정보 | 목소리 이름, 관계, 나를 부를 호칭, 알람 문구 언어, 필요한 생체정보 동의 | **이름만 필수**. 관계·호칭은 선택 |
| 생성 중 | 진행 표시와 설명만 | 서버 초안 생성 완료 |
| 미리듣기·확정 | 생성된 목소리 듣기·문구 수정, 공유 설정, 기존 목소리 교체 확인 | 끝까지 들어본 뒤 저장 또는 삭제 |
| 오프라인 준비 | 서버 생성과 기기 다운로드를 합친 진행률 | 나가도 백그라운드에서 계속 |

- **공유 설정은 확정 단계에서 고른다.** 아직 버릴 수 있는 초안의 입력 폼에서 묻지 않는다.
  승격 요청은 그 선택을 함께 저장하며, 기존 목소리를 제자리 교체하는 갈래에서도 동일하다.
  공유 on/off 푸시도 일반 승격과 제자리 교체가 같다. 교체 응답이 먼저 끝나 그룹원의 목록과
  로컬 알람이 다음 주기까지 옛 접근권을 유지하게 두지 않는다.
- **노이즈 제거 선택지는 두지 않는다.** 현재 클론 API와 백엔드가 그 값을 사용하지 않는다.
  작동하지 않는 토글을 보여 주는 것은 기능이 아니다.
- 문구 언어 기본값은 앱 언어이고, 사용자가 `한국어/English/日本語` 중 바꿀 수 있다.
  이 값이 미리듣기와 매일 사전렌더 문구의 언어가 된다.
- 생성 중·미리듣기에서 그냥 나가면 임시 목소리가 남거나 사라진 이유를 알 수 없다.
  생성 중에는 이탈을 막고, 미리듣기에서는 삭제 결과를 명시한 확인을 거친다.
- 다섯 단계는 양쪽 모두 **공용 상단바 + 스크롤 본문 + 고정 하단 행동** 골격을 쓴다.
  상단바는 `목소리 만들기`를 가운데 두고, 음원 준비에서는 목록으로 나가며 세부 정보에서는
  음원 준비로 돌아간다. 생성 중에는 뒤로가기를 숨기고, 미리듣기·확정에서는 초안 삭제 경고를
  거친다. 같은 일을 하는 하단 `이전`이나 별도 X를 함께 두지 않는다.
- 녹음 카드에는 상태·시간·녹음/재생/다시 녹음만 둔다. `12초 이상 2분 이하로 녹음해
  주세요` 같은 상시 길이 안내는 두지 않고, 실제로 짧아 다음 단계가 막힐 때 고정 하단 버튼이
  `12초 이상 녹음해 주세요`로 이유를 말한다. 12초 전에 멈춘 경우 카드 제목도
  `12초 이상 녹음해 주세요`로 바뀌며, 유효한 녹음처럼 `녹음을 저장했어요`라고 말하지 않는다.
  재생·다시 녹음 버튼은 12초 이상 녹음이 준비된 뒤에만 나타나고, 짧은 녹음 상태에서는
  마이크 버튼으로 바로 다시 시작한다.
- 음원 준비의 `녹음/파일` 선택은 양쪽이 같은 폭·높이의 2분할 버튼이다. 제목 글자만 작은
  캡슐로 남기지 않으며, 전체 칸이 보이는 버튼과 터치 영역이 된다.
- 접힌 예시 대본은 카드 높이와 화살표가 함께 부드럽게 이어진다. 시스템의 동작 줄이기 설정을
  존중하며, 전개 애니메이션이 끝날 때까지 입력을 막지 않는다.
- `내 목소리` 머리의 월 등록 한도는 **`생성 가능 n/m회`** 로 쓴다. `이번 달 n/m` 만
  쓰면 무엇을 세는지, 남은 횟수인지 사용한 횟수인지 알 수 없다. `n` 은 이번 달(KST)
  정식 등록 원장의 남은 횟수라 앱에 `1/1` 을 박아 추정하지 않는다. 다만 목소리 목록·초안과
  독립인 조회이므로 새로고침을 시작할 때 함께 병렬로 요청해 추가 왕복을 만들지 않는다.

## 5. 무료 버킷은 **울릴 때마다 다음 클립으로 넘어간다**

테마 하나에 클립이 여럿이고, 알람이 울릴 때마다 순서대로 넘어간다. 같은 테마라도
매일 다른 문구를 듣는 것이 이 기능의 요점이다.

| | 규칙 |
| --- | --- |
| 무엇을 저장하나 | 그 테마의 **클립 키 전부** + 다음에 쓸 자리 |
| 언제 전진하나 | 알람이 **끝났을 때**(정지·알럿 사라짐 — 어느 경로든) |
| 돌리지 않는 테마 | **날씨·운세** — 순서가 아니라 **조건**으로 고른다(비 오는 날엔 비 문구) |
| 그 클립이 없으면 | 받아진 것 중 하나로 대체 — 소리가 없는 것보다 순서가 어긋나는 편이 낫다 |

⚠ **iOS 는 울린 뒤 알람을 다시 예약해야 한다.** AlarmKit 은 사운드 파일을 **예약 시점에**
받아 가므로, 인덱스만 올리고 다시 예약하지 않으면 OS 는 지난 회차의 파일을 그대로 울린다.
안드로이드는 울릴 때 직접 파일을 고르므로 그 단계가 없다.

⚠ **예약할 때 돌리지 말 것.** 재예약은 시간대 변경·복구로도 일어난다 — 거기서 돌리면
울리지도 않았는데 문구가 건너뛴다.

⚠ iOS 는 2026-08-08 전까지 **회전이 아예 없었다**(`clips.first` 하나만 묶었다). 그런데
주석 두 곳은 "울릴 때마다 순차 회전한다" 고 적혀 있었다 — 코드가 아니라 주석이 기능을
광고하고 있었다.

### 5-1. 날씨·운세는 **실제 정보로** 고른다

이 둘만 회전하지 않는다. "오늘 비가 온대요" 는 **진짜 비가 올 때만** 맞는 말이라,
자리를 순서로 고르면 그 자리 문구가 거짓말이 된다.

| | 무엇으로 고르나 | 언제 정하나 | 네트워크 |
| --- | --- | --- | --- |
| **날씨** | 그 도시·그 **발사 날짜**의 실제 예보(서버가 open-meteo 조회) | 저장할 때 + 준비창(48h) 갱신 | 저장 시 1회 |
| **운세** | **사주 + 발사 날짜**로 기기에서 결정적 계산 | 읽을 때마다(계산이라 저장 불필요) | 없음 |

- 자리 번호는 **서버 클립의 `variant` 와 같은 축**이다(0 맑음 / 1 비 / 2 눈 / 3 미세먼지 /
  4 흐림 / 5 안개 / 6 더위 / 7 추위, 마지막 8 = '날씨를 못 봤어요' 안내).
  그래서 클립 묶음은 **`variant` 순으로 정렬·중복제거**해야 한다 — 순서가 흔들리면 맑은 날에
  우산 얘기를 한다.
- **못 받았으면 `null` 이고, 그건 '맑음' 이 아니다.** 0 으로 때우지 말 것. 안내 클립(마지막)이
  있는 묶음이면 그걸 틀고, 없는 옛 묶음이면 대표 클립으로 둔다.
- **운세는 같은 사람·같은 날이면 두 기기가 같은 답을 내야 한다.** 네트워크 없이 각자
  계산하므로 산식이 조금만 달라도 조용히 갈라진다. 그래서 기대값 표를 **양 앱 테스트에
  똑같이 박아** 두었다(`FortuneThemeIndexTest` ↔ `BucketVariantResolverTests`).
- ⚠ **iOS 는 조건이 바뀌면 다시 예약해야 한다.** 값만 고쳐 두면 행에는 비 문구가 적혀
  있는데 **어제 스테이징한 맑음 파일**이 울린다(위 회전과 같은 이유).

⚠ **iOS 는 2026-08-18 까지 이걸 아예 안 했다.** `prerender-variant` 호출이 없어서 날씨
알람이 저장할 때 미리듣던 클립 하나를 **매일 그대로** 재생했고(회전 대상도 아니라 바뀌지도
않았다), 운세도 마찬가지였다. 저장이 안드로이드보다 빨랐던 이유가 그것이다 — 빠른 게
아니라 **안 하고 있었다.**

### 미리 받아 둔다

울릴 시각에 네트워크가 없으면 그 회차가 조용히 비므로, **미리** 받아 둔다.

#### 기본 목소리 카탈로그는 앱에도 들어 있다

기본 목소리 4종은 ID·이름·`ready` 상태를 앱에 번들한다. 앱 시작 직후와 오프라인에서도
목소리 탭과 새 알람 편집기가 이 목록을 즉시 그리며, 서버 `GET /voice` 가 성공하면 응답
전체로 교체한다. 서버 조회를 없애는 규칙이 아니라 **첫 응답 전의 빈 목록을 없애는 규칙**이다.

- 개인·공유 목소리는 번들하거나 이전 응답으로 되살리지 않는다. 삭제·공유 해제된 생체정보가
  서버 확인 전에 다시 보이면 안 된다.
- 서버가 기본 목소리를 추가·수정하면 성공 응답이 그 회차의 권위다. 다음 앱 릴리스에서
  번들 카탈로그도 함께 맞춘다.
- 편집기 기본 목소리 선택은 스크롤 안 카드가 아니라 **화면 스코프**에서 한다. 작은 화면에서
  목소리 카드가 아직 구성되지 않아도 저장 상태와 선택 상태가 갈라지지 않아야 한다.
- 조회 시작 전/진행 중의 빈 목록과, 조회가 끝난 뒤 실제로 고를 목소리가 없는 상태를 구분한다.

#### 무엇을 언제 받는가 (2026-08-18 확정)

**목표: 알람을 만들 때 쓸 수 있는 클립은 전부 이미 폰에 있다.** 그래야 그 자리에서
문구를 합성하는 **라이브 생성 폴백이 필요 없어진다** — 그 폴백이 있는 한 "사전렌더가
준비되기 전" 이라는 임시 상태가 계속 알람에 실린다.

| 목소리 | 언제 받나 | 없으면 |
| --- | --- | --- |
| 기본(시스템) | 선다운로드(앱 시작·언어 변경·전경 복귀) | 채운다 |
| **내가 등록한 클론** | **선다운로드.** 생성(서버 사전렌더) + 다운로드가 **끝나야 등록이 끝난 것**이다 | 채운다 |
| **공유받은 목소리** | 선다운로드하지 **않는다** | 알람에서 **고르는 순간** 모달 → 준비 페이지 |

- 공유받은 목소리를 미리 받지 않는 이유: 그룹원 수만큼 곱해져 용량이 커지는데 실제로
  쓰는 것은 보통 하나다. 대신 **이미 만들어져 있어** 받기만 하면 되므로 그 자리에서 빠르다.
⚠ **개수를 박아 두지 말 것. 기준은 언제나 서버 매니페스트다.**

받아야 할 목록은 서버가 정한다(`GET /tts/stock-clips` 의 목록, 클론은
`GET /voice/:id/prerender-status` 의 `total`). 앱은 그 목록과 **디스크에 실제로 있는 것**을
비교해 **없는 것만** 받는다.

- **운영이 서버 시드를 늘리는 것을 전제로 짠다.** 프리셋을 11개에서 13개로 늘려 배포하면
  앱은 **비는 2개만** 받아야 한다. 코드나 상수에 11을 적어 두면 그 2개는 영영 안 받아지고,
  그 클립을 고른 알람은 무음이 된다. (사용자가 늘리는 값이 아니라 우리가 늘리는 값이다 —
  앱 업데이트 없이 늘어날 수 있다는 뜻이라 더더욱 상수로 두면 안 된다.)
- **'한 번 받았다' 플래그를 두지 말 것.** 캐시·데이터 지우기로 파일이 사라져도, 기본
  목소리가 새로 추가돼도 그 플래그가 켜져 있으면 다시 채우지 않는다.
  매 계기마다 **부족분을 다시 센다**(`missing = 매니페스트 − 캐시에 있는 것`).
- 진행률의 분모도 매니페스트에서 나온다 — 상수로 두면 늘어난 뒤 100% 가 안 되거나,
  줄어든 뒤 100% 를 넘긴다.
- ⚠ **클론은 서버에도 보충이 필요하다.** 시드를 새로 추가하면 **이미 만들어진 목소리에는
  그 클립이 없다** — 다운로드로 채울 수 없고 서버가 다시 렌더해야 한다.
  시드를 늘릴 때는 기존 목소리의 사전렌더 보충까지 같이 계획할 것.

#### 준비 페이지 — 생성과 다운로드를 **한 퍼센트로** 보여 준다

사용자에게는 '서버가 만드는 중' 과 '폰이 받는 중' 이 구분되지 않는다. 둘을 합쳐 하나의
진행률로 보여 준다(`GET /voice/:id/prerender-status` 의 done/total + 로컬 다운로드 수).

- **백그라운드로 계속 받는다.** 페이지를 떠나거나 앱을 내려도 멈추지 않는다.
- **진행률이 폰에서 실시간으로 보인다.**
  - 안드로이드: 진행률 알림(포그라운드 서비스)
  - iOS: **Live Activity** — iOS 에는 갱신되는 진행률 알림이 없다. 잠금화면·다이나믹
    아일랜드에 진행을 계속 보여 주는 정식 수단이 Live Activity 이고, 알람용 인프라가
    이미 있다(`AlarmTalkWidget/AlarmLiveActivity.swift`).
- **실패는 재시도한다.** 서버 생성 실패는 `POST /voice/:id/prerender-retry`(큐를 pending
  으로 되돌린다), 다운로드 실패는 그 클립만 다시 받는다.
- **오프라인이면 목소리 등록을 막는다.** 등록은 생성·다운로드가 있어야 끝나는 일이라
  반쯤 된 상태로 두지 않는다. ⚠ 단 **알람 만들기는 막지 않는다** — 새벽에 전파가 나빠
  내일 알람을 못 맞추는 일이 있어서는 안 된다. 부족한 목소리는 **그 목소리만** 고를 수
  없게 하고(준비 페이지로 보낸다), 이미 받아 둔 것으로는 언제나 알람을 만들 수 있다.

- 받는 대상(기본 목소리) = 기본(시스템) 목소리 **전부** × **기기 언어 하나** × 무료 버킷
  카테고리(weather, medication) = 4 × 11 = **44개**
- 언어를 하나로 좁힌다 — 앱은 한 번에 한 언어만 쓰고, 언어를 바꾸면 다시 돌아 채운다
- greeting 은 앱에 내장돼 있어 받지 않는다
- 운세·사랑은 유료 클론 전용이라 기본 목소리로는 쓸 수 없다
- 한 클립이 실패해도 나머지는 계속 받는다 — 회전은 남은 것만으로도 돈다.
  **전부 실패했을 때만** 실패로 본다.

#### 언제 받는가 — **한 번이 아니다**

⚠ 예전에는 이 절이 "로그인 직후" 라고만 적어서, 읽는 사람이 **1회성 온보딩 작업**으로
오해했다(실제로 iOS 는 그렇게 구현돼 있었고 언어를 바꿔도 새 언어분을 영영 안 받았다).

| 계기 | 안드로이드 | iOS |
| --- | --- | --- |
| 앱 시작(세션·동의 확인 뒤) | `AlarmTalkApp.kt` 의 `loadStockClips()` + `prefetchStockClips()` | `AlarmTalkApp.swift` 의 계정+언어 키 task |
| 기기 언어 변경 | 같은 자리(다음 실행) | 같은 task(언어가 키에 있다) |
| 포그라운드 복귀 | — | `scenePhase == .active` 에서 보충 |
| 실패 후 재시도 | WorkManager 30초 선형 백오프 | 같은 정책 3회 |

**이미 캐시된 클립은 건너뛴다** — 그래서 여러 번 불러도 값이 싸다. "빠진 것만 보충" 이
이 작업의 정상 동작이고, 중복 호출은 버그가 아니다.

#### 고를 때·저장할 때 — **네트워크를 타지 않는다**

⚠ **이 절이 없어서 사고가 났다.** 근거가 없으니 읽는 사람이 코드 한 줄(다운로드 폴백)만
보고 "테마를 고르면 그때 받는다" 로 일반화했다(2026-08-12).

| 시점 | 무엇을 하나 |
| --- | --- |
| **테마를 고를 때** | **값만 바꾼다.** 안드로이드 `bindStockBucketClips` 는 `getCachedAudio(cacheKey) ?: 다운로드` 로 **캐시 우선**이고, iOS `prepareStockClip` 도 같다. 선다운로드가 제 일을 했으면 네트워크가 없다 |
| **저장할 때** | 그 (목소리·테마·언어)의 클립 목록을 **묶기만** 한다. 조건형(날씨·운세)은 조건에, 회전형(약·사랑)은 순번에 맞춰 고른다 |
| 캐시가 비어 있으면 | 그때만 받는다 — 선다운로드 실패에 대한 **폴백**이지 정상 경로가 아니다 |

⚠ **테마 선택을 준비된 음원에서 파생시키지 말 것.** iOS 는 2026-08-12 전까지 "어떤 테마를
골랐는가" 를 `preparedAlarm`(미리듣기용 준비 음원)에서 거꾸로 읽었다. 그래서 음원을 못
받으면 **고른 적 없는 것으로** 표시됐고, 문구 행이 "불러오는 중이에요" 에서 벗어나지
못했다. 선택은 값 하나여야 한다(안드로이드 `AlarmEditorState.selectedBucket`,
iOS `selectedBucketDraft`).

#### 알람 편집기에 **미리듣기 칩을 두지 않는다**

고른 목소리·문구로 음원을 미리 만들어 재생 버튼과 문구를 띄우던 UI 는 2026-08-12 에
없앴다. 안드로이드에는 처음부터 없었고, iOS 만 갖고 있었다. 되살리지 말 것 —
목소리 자체를 들어보는 미리듣기(목소리 시트·공유 목소리)와 녹음 재생은 **다른 것이고 남는다**.

⚠ 이 화면은 **고르는 화면이 아니라 받는 화면**이다. "기본 목소리를 골라보세요" 같은
피커로 되돌리지 말 것 — 목소리는 **알람 편집기에서** 고른다.

## 6. 무료로 내려가면 — **알람은 잠그고, 목소리는 3일 뒤 지운다**

축이 **둘**이다. 섞어 읽으면 반드시 사고가 난다.

| 무엇을 | 어떻게 |
| --- | --- |
| **알람 행** | **지우지 않는다.** 시각·반복·문구·목소리 선택 전부 보존 |
| 재생 방식 | 원래 값을 `preLockPlayMode` 에 보관하고 `alarm_only` 로 내린다 |
| 예약 | 사운드온리로 **다시 예약한다** — 안 하면 잠근 게 아니라 조용히 안 울리는 알람이 된다 |
| 기기 음원 캐시 | 지우지 않는다 |
| **서버 목소리 데이터** | **유예 3일 뒤 영구 삭제**(`PAID_VOICE_RETENTION_DAYS`) — 목소리 프로필·업로드 원본·생성 음성·ElevenLabs 클론·R2 객체 |
| 유예 **안에** 유료 복귀 | 삭제를 취소하고(`hasActivePaidEntitlement` 재확인 → `clearPaidVoiceRetention`) `preLockPlayMode` 로 되돌린다 |
| 유예 **뒤** 유료 복귀 | 알람 행은 복원되지만 **말할 목소리가 없다** — 다시 등록해야 한다 |

⚠ **알람 행 삭제는 되돌릴 수 없다.** iOS 가 실제로 행과 음원을 함께 지우고 있었다 —
재결제해도 돌아오지 않았다. 알람 앱에서 "내일 아침 알람이 없어졌다" 는 가장 무거운
실패다(2026-08-07 수정). **이 문장은 알람 행에 대한 것이다** — 목소리 데이터는 위 표대로
의도적으로 지운다.

⚠ **"다시 등록하면 복구돼요" 라고만 쓰지 말 것.** 유예가 지나면 거짓이 된다. 사용자에게
말할 때는 **기한과 결과를 함께** 말한다("3일 안에 …, 지나면 영구 삭제돼요").
구현: `downgrade_notice_free_message`·`msg_gb_free_plan_voice_alarms_locked`(안드),
`RootView` 강등 모달·`SocialFeatureViewModel`(iOS).

⚠ **예고는 눈에 보여야 한다.** 강등 신호(`family_alarm`·`voice_access_revoked`·
`plan_changed`)는 전부 **무음 데이터 푸시**라 앱을 열어야만 안다. 삭제는 되돌릴 수 없고
3일 안에 앱을 한 번도 안 여는 사람이 정확히 잃는 쪽이라, 예고만은 표시용 푸시를 보낸다
(`sendVoiceDeletionWarningPush` ← `notifyVoiceDeletionScheduled`, 커밋 뒤 호출).

### 받은(가족) 알람은 **다른 축**이다

받은 알람의 목소리는 **접근권**(공유가 살아 있는가)이 정한다. **받는 사람의 플랜으로
다스리지 않는다.**

- 공유가 끊기면 서버가 받은 알람까지 `sound-only` 로 걷어낸다(`paid-voice-cleanup.ts`,
  `is_received` 포함) → pull sync 로 양 앱에 내려온다.
- 그래서 잠금(`lockPaidAlarmTalks` / `paidAlarmTalks`)은 **`origin == LOCAL_OWNED` 만** 본다.

⚠ **발신자가 직접 녹음해 보낸 `family-voice`는 클론 프로필 음원이 아니다.** 메시지 행의
`voice_profile_id`는 수신자 프로필을 임시로 채운 값이고 실제 파일은 발신자의
`voice_uploads.object_key`다. 수신 확인 tombstone은 이를 `sender_voice_upload=1`로 따로
기억해, 발신자의 탈퇴·음성 동의 철회 때만 걷어낸다. 수신자의 무관한 클론 삭제로는
걷어내지 않는다.

⚠ **목소리 직접 삭제의 DB 작업은 한 트랜잭션이다.** 프로필 tombstone·원본 업로드 정리와
그 목소리를 쓰는 알람/tombstone 철회를 따로 커밋하지 않는다. 배포 직후 새 철회 컬럼의
마이그레이션이 아직이면 전체를 롤백해 재시도 가능하게 해야 한다. 프로필만 먼저 사라지면
재시도는 404가 되고, 받은 기기의 캐시 음성을 철회할 근거가 영구히 남지 않는다. 외부
ElevenLabs 삭제와 푸시 전송만 DB 커밋 뒤에 실행한다.

목소리 삭제 푸시는 그룹원뿐 아니라 **삭제한 계정 자신의 다른 기기**에도 보낸다. 현재 기기가
로컬 정리를 했어도 다른 기기의 아직 미동기화된 알람은 서버 알람 조회로 찾을 수 없다. 단
계정 탈퇴는 그 계정의 기기가 곧 정리되므로 `excludeOwnerUserIds`로 본인 통지를 제외한다.

⚠ **플랜 축을 받은 알람에 걸면 결제 보류(유예)에서 오발한다.** `resolvePlanAfterSuspend` 는
그룹·공유를 살려 둔 채 `users.plan` 만 회수하므로, 카드가 잠깐 실패한 사이 파트너가 보낸
알람의 목소리가 잠긴다. 게다가 해제는 **받는 사람이 유료가 될 때만** 돌아 영구히 남을 수
있다(2026-08-11 안드로이드에서 제거).

애초에 "무료인데 받은 알람이 있다" 는 상태는 셋뿐이다 — 받으려면 그룹 멤버여야 하고
(`assertSameGroup`) 멤버는 그룹 플랜을 물려받는다(`propagateGroupMemberPlans`):
① 결제 보류(유예) ② 그룹 이탈 ③ 소유자 해지. **②③ 은 서버가 이미 강등**하므로,
플랜 축을 떼면 ①(지켜야 할 유예)이 판정을 따로 만들지 않아도 지켜진다.

⚠ **두 번 잠가도 원래 값을 잃지 않아야 한다.** `preLockPlayMode` 가 이미 있으면 덮어쓰지
않는다 — 덮어쓰면 두 번째 잠금이 `alarm_only` 를 '원래 값' 으로 적어 복원이 불가능해진다.

⚠ **소유자를 확인한다.** 같은 기기에서 계정을 바꾸면 앞 계정 알람까지 잠글 수 있다.
소유자가 안 적힌 옛 행은 이 계정 것으로 본다.

⚠ **문구를 '삭제했어요' 로 쓰지 말 것.** 지우지 않았고, 알람은 알람음으로 계속 울린다.

## 7. 의도된 플랫폼 차이

| 항목 | 안드로이드 | iOS | 이유 |
| --- | --- | --- | --- |
| 알람 음량 슬라이더 | 있다 | **없다** | AlarmKit 이 OS 톤을 소유해 제어 불가 |
| 오디오 스테이징 | 필요 없음 | `.caf`(LPCM) 로 직접 쓴다 | AlarmKit 은 `AlertSound.named(_)` 파일만 울린다 |

⚠ iOS 오디오 스테이징을 `AVAssetExportSession` 으로 하지 말 것 —
`AVAssetExportPresetAppleM4A` 는 `.caf` 를 못 내므로 staging 이 **항상** 실패하고,
잠금화면·앱 종료 상태에서 목소리가 아예 안 울린다. `AVAssetReader`→`AVAssetWriter` 로
CAF 를 직접 쓰고 `AVChannelLayoutKey` 를 반드시 넣는다(없으면 파일은 생기는데 열리지 않는다).

## 구현 지도

| 규칙 | Android | iOS | 백엔드 |
| --- | --- | --- | --- |
| 재생 방식 2택 | `PlayModeCard` (`ui/editor/AlarmEditorControls.kt`) | `VoicePlayModePicker` | `wake_mode` (`voice_only` / `sound_then_voice`) |
| 옛 값 정규화 | `AlarmPlayModes.normalize` | `AlarmPlayMode.decode` | — |
| 기본목소리 제한(OR) | `restrictToWeatherMedication` (`ui/editor/AlarmEditorScreen.kt`) | `restrictToWeatherMedication` (`Views/Editor/AlarmEditorSheet.swift`) | `tts.ts` 무료 등급 게이트 |
| 상태 강제 | `LaunchedEffect(restrictToWeatherMedication, …)` | `coerceFreeVoiceTierConstraints` | — |
| 목소리 전환 경고 | `pendingVoiceSwitch` (`ui/editor/VoiceAudioCard.kt`) | `pendingVoiceSwitch` (`AlarmEditorSheet.swift`) | — |
| 직전 선택 저장 | `DefaultVoicePreferenceStore` / `DynamicPromptPreferenceStore` | `DefaultVoicePreferenceStore` | — |
| 버킷 클립 선다운로드 | `sync/StockClipPrefetchWorker.kt` | `StockClipPrefetcher.swift` | `GET /tts/stock-clips`, `GET /tts/messages/:id/audio` |
| 기본 목소리 즉시 카탈로그 | `data/SystemVoices.kt` + `MainViewModel.voiceProfiles` | `SystemVoices.swift` + `VoiceStudioViewModel.profiles` | 성공한 `GET /voice` 가 전체 목록 권위 |
| 편집기 목소리 프리셀렉트 | `AlarmEditorScreen` 화면 스코프 | `AlarmEditorSheet.selectDefaultVoiceProfileIfNeeded` | — |
| 목소리 등록 5단계 | `VoiceProfileManagementPanel.VoiceRegistrationStep` | `VoicesRoute` + `VoiceCloneUploadFlow.RegistrationStep` | 초안 생성·승격·사전렌더 큐 |
| 등록 언어·선택 페르소나 | `VoiceProfileManagementPanel` Details | `VoiceCloneUploadFlow.detailsSection` | `POST /voice/clone` |
| 확정 단계 공유 | `VoiceProfileManagementPanel` Preview | `VoicePreviewConfirmView` | `PATCH /voice/:id` (`is_shared` + `is_draft=false`) → `scheduleVoiceShareChangedPush`(일반 승격·제자리 교체 공용) |
| 클립 회전 | `AlarmRepository.advancedBucketRotationIndex` / `resolveBucketClipSelection` | `LocalAlarmStore.advancedBucketRotationIndex` + `AlarmSoundResolver.rotatedBucketClipKey` + `AlarmAppContext.rescheduleForNextBucketClip` | — |
| 회전 상태 영속 | `AlarmEntity.bucketClipKeysJson` / `bucketRotationIndex` | `LocalAlarmRecord.bucketClipKeys` / `bucketRotationIndex` | — |
| 날씨·운세 자리 판정 | `AlarmEntity.bucketVariantIndex()` | `BucketVariantResolver.variantIndex(for:)` | — |
| 운세 온디바이스 계산 | `fortuneThemeIndex` (`data/AlarmEntity.kt`) | `BucketVariantResolver.fortuneThemeIndex` | — |
| 날씨 조건 조회 | `AlarmRepository.resolveWeatherVariantForDraft`(저장 시) | `AlarmEditorSheet.applyWeatherVariant`(저장 시) | `GET /tts/prerender-variant` (`resolvePrerenderWeatherIndex`) |
| 날씨 준비창 갱신 | `AlarmRepository.resolveDueCloneBucketVariants` + `weatherVariantNeedsRefresh` | `WeatherVariantRefreshService` + `BucketVariantResolver.weatherVariantNeedsRefresh` | 같은 라우트 |
| 조건 스냅샷 영속 | `AlarmEntity.contextVariantIndex` / `contextResolvedAtMillis` | `LocalAlarmRecord.contextVariantIndex` / `contextResolvedAtMillis` | — |
| 클립 자리 = `variant` | `bindStockBucketClips`(sortedBy·distinctBy) | `AlarmEditorSheet.bucketClipKeys(forCategory:)`(같은 규칙) | `ORDER BY … variant ASC`, `StockClip.variant` |
| 운세 양앱 일치 테스트 | `FortuneThemeIndexTest` | `BucketVariantResolverTests` | — |
| 오디오 캐시 키 | `stock_<messageId>` | `AudioCacheStore.stockCacheKey` (같은 규칙) | — |
| 무료 전환 잠금 | `AlarmRepository.lockPaidAlarmTalks` / `unlockPaidAlarmTalks` | `SocialFeatureViewModel.applyFreePlanVoiceLock` / `restorePaidVoiceAlarms` | `users.plan`, `resolvePlanAfterSuspend` |
| 목소리 데이터 3일 유예 | `AlarmRepository.lockPaidAlarmTalks`(행만) | `SocialFeatureViewModel.applyFreePlanVoiceLock`(행만) | `PAID_VOICE_RETENTION_DAYS` · `schedulePaidVoiceRetention` · `clearPaidVoiceRetention` |
| 유예 만료 삭제 | — | — | `sweepPaidVoiceRetention` → `deleteSensitiveVoiceDataForUser`(삭제 직전 `hasActivePaidEntitlement` 재확인) |
| 삭제 예고 푸시 | `fcm/AlarmTalkMessagingService.kt` | `PushNotificationCoordinator` | `notifyVoiceDeletionScheduled` → `sendVoiceDeletionWarningPush` |
| 받은 알람은 접근권 축 | `lockPaidAlarmTalks` 의 `origin == LOCAL_OWNED` | `LocalAlarmStore.paidAlarmTalks` 의 `.localOwned` | `paid-voice-cleanup.ts`(`is_received` 까지 sound-only) |
| 클립 선다운로드(앱 시작·언어 변경) | `sync/StockClipPrefetchWorker.kt`, `ui/app/AlarmTalkApp.kt` 의 `prefetchStockClips()` | `StockClipPrefetcher.swift`, `AlarmTalkApp.swift` 의 계정+언어 task | `GET /tts/stock-clips`, `GET /tts/messages/:id/audio` |
| 고를 때는 **캐시 우선**(네트워크 폴백) | `ui/editor/AlarmEditorScreen.kt` 의 `bindStockBucketClips` | `VoiceStudioViewModel.prepareStockClip` | — |
| 테마 선택은 **독립 상태**(음원 파생 금지) | `AlarmEditorState.selectedBucket` | `AlarmEditorSheet.selectedBucketDraft` | — |
| 저장된 알람이 기기 언어를 따라감 | `sync/StockClipLanguageRebinder.kt` | `StockClipLanguageRebinder.swift` | — |

## 검증 방법

목소리가 **실제로 나오는지**는 실기기에서만 확인된다. 특히:
- raw API 로 만든 알람은 `voice_profile_id`·`message_id`·`bucket_id` 가 비어 있어
  톤만 울린다 — 그건 정상이다. **앱 UI 로 만든 알람**으로 검증해야 한다.
- 무료 등급은 버킷 클립 선다운로드가 끝난 뒤여야 오프라인에서도 소리가 난다.
