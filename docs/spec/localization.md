# 앱 화면 언어

## 1. 기본 규칙

앱 화면은 한국어·영어·일본어를 지원한다. 같은 기능의 문구는 Android를 기준으로 두 앱이 같은 뜻과
표현을 쓴다. 원문과 뜻이 다른 Android 번역은 먼저 바로잡고 iOS에도 반영한다.

Swift 소스와 `Localizable.xcstrings`는 함께 고친다. 번역이 카탈로그에 있어도 일반 `String`으로 넘기면
조회되지 않는다. 문자열을 받는 공용 컴포넌트에는 호출부에서 `String(localized:)`로 조회한 값을 넘긴다.
동적 문자열을 받는 인자를 일괄 `LocalizedStringKey`로 바꾸지 않는다. Android는 `stringResource` 또는
`Context.getString`을 쓴다. 자리표시자의 개수·타입·순서와 줄바꿈을 보존한다.

줄바꿈할 수 있는 제목·본문은 흐르게 둔다. 시간 휠·하단 버튼처럼 한 줄이어야 하는 자리의 축소 기준은
`WakerDesign.kt`의 `fitToWidthScale` 규약을 따른다.

## 2. 저장값과 표시 문구

저장·서버 전송 값은 번역하지 않는다. 운세의 성별·시간 구간, 관계 라벨, 기본 알람 이름, 가족 알람의
전송 라벨, 옛 날씨 지역 값, 공휴일 시드는 계약값이다. 화면 표시만 현재 앱 언어로 바꾼다.
운세의 옛 성별·시간 모름 별칭은 기존 정규화 규칙으로 뜻을 확인한 뒤 표시만 번역한다.
사용자가 직접 입력한 이름·관계·문구는 번역 대상이 아니다.
가족 알람 녹음의 기본 라벨은 계약값 「가족이 보낸 음성」을 앱 언어와 무관하게 그대로 보낸다(서버 기본값과
같다). 받는 기기는 저장된 문구가 그 값과 정확히 같을 때만 울림 화면에 현재 언어의 「상대가 보낸 음성」을
보여 준다. 보낸 사람은 커플 상대일 수도 있으므로 가족이라고 단정하지 않는다. 번역문을 보내던 옛 Android
빌드의 「Voice from family」·「家族からの音声」도 같은 값으로 읽고, 보낸 사람이 친 라벨은 그대로 둔다.
관계 프리셋은 선택 상태에 프리셋 종류가 명시된 동안만 번역한다. 기존 저장 계약은 관계 문자열만
보존해 직접 입력 여부를 복원할 수 없다. 따라서 저장된 관계는 프리셋과 글자가 같아도 원문으로 표시하고,
재편집할 때는 직접 입력으로 복원한다. 문자열 일치만으로 프리셋을 추측하지 않는다.
저장된 관계(`relationship_label`)는 두 앱 모두 **목록에 표시하지 않는다** — 목소리 탭의 행, 알람 행의
목소리 이름, 편집기의 목소리 선택 모두 그렇다. 번역할 수 없는 저장 문자열이라 영어·일본어 화면에
「엄마」가 섞였다. 목소리 탭 행은 공유 여부(「공유 중」)만, 알람 행은 목소리 이름만, 편집기 선택 시트는
「내 목소리」(공유 중이면 「내 목소리 · 공유 중」)를 쓴다. 관계의 저장·전송과 등록·수정 폼의 입력은 그대로다.

기본 목소리 이름은 목소리 id로, 플랜 이름은 plan key로 표시 이름을 고른다. 서버가 보내는 한국어 이름을
화면 번역 키로 삼지 않는다. 목록에 없는 기본 목소리 id는 서버 이름을 그대로 표시한다. 뜻이 다른 곳은 한국어 원문이 같아도 키를 나눈다(알람 탭과 재생 방식,
목소리 탭과 목소리 한 개, 요일과 생년월일, 문구 직접 입력과 관계 직접 입력).

## 3. 오류와 이름의 존칭

서버 오류는 `error_code`에 대응하는 앱 문구 또는 화면의 고정 폴백을 쓴다. 글에 한글이 있는지를 기준으로
노출 여부를 가르지 않는다. 세부 계약은 [error-codes.md](error-codes.md) §4를 따른다.

보낸 사람 이름의 존칭은 한 곳에서만 붙인다(한국어 님·일본어 さん·영어 없음). 존칭을 붙인 결과를 받는
문장 틀에 존칭을 다시 넣지 않는다. 이름 자체가 님·さん으로 끝나면 존칭을 더 붙이지 않는다. 이름을 모르는 사람을 친구나 가족이라고 단정하지 않는다.
가족 알람을 보낸 뒤의 완료 문구는 받는 사람의 **이름**만 쓰고, 이름이 없으면 이메일이나 화면용 대체
이름(「멤버」) 대신 「상대에게 알람을 설정했어요」로 말한다 — 보낸 사람은 방금 그 사람을 골랐다. 받는
쪽(받은 알람 이름·알림 제목)은 보낸 사람을 가려야 하므로 이름이 없으면 이메일을 쓴다.

Android 스낵바의 색(성공·오류·안내)은 문구의 글자가 아니라 **문구 종류**로 고른다. 낱말 표지는
언어마다 뜻이 갈린다(일본어 「ません」이 성공 문구를, 영어 "sent"가 "consent"를 잡았다). 스낵바로 가는
문구는 한 표에 종류를 적고, 화면의 글을 세 언어로 펼친 그 문구와 맞춰 본다. 표에 없는 글은 안내다.

코드 등록 실패는 그 등록 시도에서 나온 문구만 입력창 아래에 표시한다. 다른 작업이 진행 중이라
등록을 시작하지 못한 경우에도 이전 성공·강등 안내를 등록 오류로 재사용하지 않는다.

## 4. 용어

| 한국어 | 영어 | 일본어 | 적용 |
| --- | --- | --- | --- |
| 이용권 | plan | 利用券 | 영어 pass와 섞지 않는다. 기존 일본어의 プラン 문장은 유지한다 |
| 이용권 코드 | plan code | 利用券コード | 사용자에게 보이는 이름만 바꾼다 |
| 무료·개인·커플·가족 플랜 | Free·Personal·Couple·Family plan | 無料·パーソナル·カップル·ファミリープラン | 관계·그룹의 가족은 그대로 家族 |
| 알람·목소리·더보기 탭 | Alarms·Voices·More | アラーム·声·その他 | 단수 재생 방식과 키를 나눈다 |
| 문구 | message | 文言 | 기존 같은 화면의 Android 번역을 우선한다 |
| 기본 목소리 | default voice(s) | 基本の声 | 한 개와 목록 제목을 구분한다 |
| 직접 입력 | Type it yourself | 自分で入力 | 관계 선택은 Custom |
| 다시 울림 | Snooze | 再通知 / スヌーズ | 일본어 버튼은 再通知, 간격·설정은 スヌーズ |
| 알람 해제 | Dismiss | アラームを止める | 목록의 켜기·끄기와 구분한다 |
| 미리듣기 | Preview | プレビュー | 목소리 등록 화면 |
| 운세 정보 | Fortune info | 占い情報 | 카드와 입력 시트 |
| 이름을 모르는 상대 | someone / the other person | 相手 | 기능명 your partner's alarm은 유지한다 |

영어·일본어 앱 화면의 브랜드는 `AlarmTalk`이다. 언어 선택지는 `한국어`·`English`·`日本語`처럼
각 언어의 자기 이름으로 쓴다. 영어 문장 안의 플랜 이름도 대문자로 쓴다.

약관·개인정보처리방침 웹 링크는 현재 앱 언어의 경로를 쓴다(ko·en·ja, 그 밖은 ko).
동의 화면의 번들 문서와 동의 버전 계약은 그대로다.

## 5. 언어 변경과 검증

Android 알림 채널의 이름·설명은 앱 언어 구성 변경과 전경 복귀 때 갱신한다. 채널 id·중요도·소리·진동 설정은 유지한다.

이미 저장된 값도 표시할 때 현재 언어를 따른다. OS가 보관하는 알람 표시 문구는 언어가 바뀐 뒤
예약을 다시 맞출 때 갱신한다. 울림 경로에서 번역을 위한 네트워크 요청을 추가하지 않는다.

iOS는 계정별 마지막 표시 언어와 알람별 예약 언어를 로컬에 기록한다. 언어가 바뀌면 해당 계정의
켜진 예약을 기존 직렬 재조정 경로로 다시 건다. 알람별 기록이 있으면 그 알람은 **그 기록만으로**
판단한다. 계정 기록은 알람별 기록이 없는 옛 예약의 언어를 대신할 뿐이다. 계정 기록이 지금 언어와
같아도 알람별 기록을 건너뛰지 않는다 — 일부만 다시 건 뒤 언어를 되돌리면, 먼저 다시 건 알람이
다른 언어로 남는다.

언어 때문에만 다시 거는 알람은 **AlarmKit이 그 핸들을 대기(`scheduled`) 상태로 들고 있을 때만**
건드린다. 행의 켜짐·상태만 보지 않는다. 앱이 꺼진 채 잠금 화면에서 끄거나 다시 울림을 누르면
인텐트가 행을 고치지 못해, 행은 켜진 채 옛 핸들을 들고 있다. 그 행을 다시 걸면 끈 1회성 알람이 다음
회차에 다시 울리고, 다시 울림 카운트다운이 취소돼 다시 울리지 않는다. 그래서 핸들이 AlarmKit에
없거나(전경의 관찰자가 끝난 알람으로 처리한다) 울리는 중·다시 울림 대기 중(`alerting`·`countdown`·
`paused`)이거나 AlarmKit 목록을 읽지 못하면 건너뛰고 다음 회차에 다시 본다. 행이 울리는 중·스누즈
중으로 기록된 알람도 건너뛴다. 새 예약 성공 뒤에만 옛 핸들을 해제하며, 일부만 성공해도 성공한
예약을 반복하지 않는다. 건너뛴 알람을 포함해 대상이 하나라도 남으면 계정의 언어 기록을 바꾸지
않는다. 알람을 지우면 그 알람별 기록도 지운다.

이 기능의 첫 실행에는 기존 받은 알람의 자동 라벨이 현재 언어와 다른 경우만 고친다. 받은 알람의
자동 라벨은 세 언어의 정확한 문장 틀과 일치할 때만 표시를 다시 만들고, 직접 고친 라벨과 저장값은
보존한다.

받은 알람의 녹음 문구(가족 알람 녹음 기본 라벨, §2)는 예약할 때 실은 표시를 알람별로 기록하고, 지금
표시와 다르면 **언어 기록과 무관하게** 다시 건다. 이 규칙 이전에 같은 언어로 걸린 예약은 언어 기록이
지금과 같아 그대로 두면 원문을 실은 채 남기 때문이다. 기록이 없으면 원문을 실었다고 본다. 다시 거는
조건(AlarmKit 대기 상태만)은 위와 같다.

번역 누락 검사는 사용자에게 보이는 문자열을 대상으로 한다. 로그·테스트·사용자 입력·데이터 계약값·
TTS 입력 문장은 구분한다. 카탈로그의 번역 유무와 호출부가 실제로 번역을 조회하는지를 모두 본다.
각 화면의 변경에서 같은 화면의 두 앱 문구, 자리표시자, 영어·일본어의 레이아웃을 확인한다.
같은 시각 알람 교체 확인은 두 앱 모두 시각만 넣어 묻는다(「HH:mm 알람을 새 알람으로 교체할까요?」).
운세 입력 카드와 시트의 이름은 「운세 정보」로 맞춘다.
스토어의 앱 화면 언어 지원 문장은 전체 화면의 번역 누락을 처리한 뒤 복원한다.

## 6. 번역 누락 CI 검사

`python3 scripts/check-hangul-literals.py`는 iOS 앱·위젯·Shared의 Swift 리터럴과 두 카탈로그,
InfoPlist 카탈로그, Android main의 Kotlin·언어별 XML 리소스를 검사한다. Swift는 정적 SwiftUI 키,
명시적 번역 조회, 선언에서 확인한 `LocalizedStringKey`·`LocalizedStringResource` 인자와 반환을
구분한다(`stringLiteral:`·`String.LocalizationValue(…)` 초기화와 `NSLocalizedString`·`Bundle.localizedString(forKey:)`도
키 조회다). 키 타입으로 선언한 값의 삼항·`??`·`case` 결과 분기는 모두 키다(비교하는 피연산자는 아니다). 라벨 없는 매개변수
(`func row(_ title: LocalizedStringKey)`, `init(_ title: …)`)는 위치로 대응한다(삼항·`??` 결과 분기 포함). 사용자 타입의 `init`(본문·확장)과
memberwise 속성, 함수의 라벨 있는 매개변수는 같은 라벨을 받는 모든 오버로드가 키 타입일 때만 키 자리다. 삼항·nil 병합 등으로 일반 `String`이 되는 호출은 각 분기에서 명시적으로 번역한다.
`NavigationLink`·`Menu`·`DisclosureGroup`·`ProgressView`·`TableColumn`·`Gauge`·`.help`·`.badge`처럼 첫 문자열 인자가 키인 표준 SwiftUI
초기화·수정자(`.searchable(prompt:)`·`.accessibilityAction(named:)`·`.accessibilityInputLabels([…])` 포함)도 키 조회로 본다. `[LocalizedStringKey]`·`[String: LocalizedStringKey]`·`(LocalizedStringKey, …)`처럼
키를 담는 컬렉션·튜플로 선언된 값·반환·매개변수의 원소 리터럴도 키 조회로 본다(삼항·`??` 결과 컬렉션 포함). 표시 인자 안의
`map`·`flatMap`·`compactMap`·즉시 실행 클로저가 돌려주는 리터럴은 그 표시 인자의 문구로 본다.
Kotlin의 Text·BasicText·알림 문구(제목·본문·액션 버튼·채널 이름과 설명)와 title/text/contentDescription 등 표시 인자,
`semantics { contentDescription = … }`·`Icon(icon, "…")`의 위치 인자 같은 접근성 문구, 채널·View·다이얼로그의
`setDescription`·`setTitle`·`setMessage` 등 세터와 대화형 알림(`MessagingStyle.Message`·`addMessage`·`setConversationTitle`)은 원문 언어와 관계없이 리소스를 쓴다.
`buildAnnotatedString`·`buildString` 안에서 `append` 한 문구, `remember { … }`·`let { … }`처럼 값을 돌려주는 람다의
마지막 식, `when` 분기의 `->` 뒤 값은 그 결과를 받는 표시 인자의 문구로 본다(`when` 조건에서 비교하는 값은 제외).
앱이 정의한 함수의 `String` 매개변수가 본문(블록·식 본문 모두)에서 표시 자리로 가면(Swift는 함수·`init`
매개변수와, 본문에서 표시되는 저장 속성의 memberwise 라벨도 같다 — `PromptDetailCard(value:)` 등)(`WakerSheetOptionRow`의
`description` 등) 그 함수의 호출 인자도 표시 문구로 본다(감싼 함수의 감싼 함수까지). 값 람다는 괄호 안에
`calculation = { … }`처럼 넘겨도 같다. 바인딩 초깃값의 결과로 쓰인 리터럴(`val title = "…"`,
`val title = if (on) "A" else "B"`, `?:`·`when` 분기, Swift의 삼항·`??`·`switch` 결과)은 같은 블록 안의 표시 자리
사용까지 따라간다. 호출 인자나 비교 피연산자로 쓰인 리터럴은 따라가지 않는다. `"%02d:%02d"`처럼 서식 자리표시자뿐인 문자열은 문구가 아니다. 문자 리터럴(`'월'`)도 표시 자리에 쓰이면 같다.
카탈로그의 영어·일본어에는 한글을 남기지 않고, Android 번역은 배열·복수형의 각 항목까지 비어 있으면 안 된다.
영어 날짜 선택기의 년·월·일 접미사 세 리소스만 빈 값을 허용한다(숫자만 표시); 키 누락이나 한글 잔존은 허용하지 않는다.
문자열 배열은 언어마다 항목 수가 같아야 한다(면제 없음). 한국어 기본 리소스(`values/`)도 비어 있으면 안 되고, 복수형에는 `other`가 있어야 한다. 언어 한정자 없는
`values-night`·`values-v27` 같은 디렉터리의 문자열도 한국어 원문으로 보고 영어·일본어 번역을 요구하며, 모든 구성 변형
(`values-night`, `values-en-night`, 지역 `values-en-rUS` …)을 같은 구성·지역의 한국어 변형(없으면 기본값)과 대조한다.
Kotlin은 `src/main/java`와 `src/main/kotlin`을 모두 본다. `values-en*`·`values-ja*`에만 있고 기본(`values*`)에 없는 리소스는 실패한다. `<item type="string">`도 문자열 리소스로 본다.
Swift의 일반 String 표시 인자도 원문 언어와 관계없이 명시적으로 번역한다. 두 플랫폼의 자리표시자는
위치·변환 타입·사용 횟수를 유지하며 순서 변경만 허용한다. 배열·복수형·기기별 변형의 각 값까지 대조한다.
명시된 한국어 번역도 빈 값과 서식을 확인한다. 한글 원문 키의 서식은 한국어 값과도 대조한다.
Swift 여러 줄 문자열 키는 닫는 `"""`의 들여쓰기만 지운 값이다(더 깊은 들여쓰기는 남는다). Swift 보간은 확인 가능한 기본 타입으로 키를 만들며, 타입을 판단할 수 없는 표현식에는 명시적 타입이나 변환을 쓴다.
멤버 접근(`b.value`)은 수신자 타입을 풀지 않으므로, 같은 이름의 모든 멤버 선언(타입 표기·초깃값 추론 모두)이
같은 타입일 때만 그 타입으로 본다. 다르거나 알 수 없으면 명시적 변환을 요구한다. 멤버는 타입 본문에 바로 선언된
속성뿐이다 — 매개변수·지역 선언·튜플 라벨은 `b.value`의 타입을 정하지 않는다. 이름만 쓴 보간도 실제 선언
(`let/var`, 함수·`init` 매개변수)만 보고, 호출 인자 라벨(`consume(count: Int(3))`)이나 패턴 바인딩
(`case .restored(let count)`)으로는 타입을 정하지 않는다 — 그런 자리는 `Int(count)`처럼 명시한다.
의미 키(`String(localized: "plan.name.free", defaultValue: ...)`)의 기본값은 모든 번역에 서식 인자를
공급하므로, 기본값의 보간 타입·자리표시자·줄바꿈을 그 키의 한국어 값과 대조한다.
영어 복수형에는 one·other, 일본어·한국어에는 other가 필요하다(Android 복수형과 iOS 카탈로그의 plural 변형·대체 변수 모두).
한국어 원문이 복수형으로 나뉘면 영어도 복수형 변형을 유지한다(단일 문장이면 1개일 때도 복수형 문장이 나온다).
복수형 변형은 번역의 같은 자리(같은 기기 분기·같은 이름 대체 변수)에서도 나뉘어야 한다(나뉘는 인자가 하나뿐이면 문장 전체와
대체 변수 사이로 옮겨도 된다). 각 localization에는 렌더할 문장(최상위 문자열이나 변형)이 있어야 한다.
카탈로그 대체 변수(`%#@name@`)는 `argNum`·`formatSpecifier`와 `%arg`를 펼친 문장으로 대조한다.
선언된 변형·범주·대체 변수에는 번역된 값이 하나 이상 있어야 한다(`"other": {}`는 비어 있는 번역이다).
기기별 변형에는 다른 기기가 쓸 `other`가 있어야 하고, 한국어 원문이 나눈 기기 분기는 번역의 같은 자리(같은 대체 변수 안)에도 있어야 한다.
InfoPlist 카탈로그(권한 설명)도 서식·줄바꿈을 한국어 값과 대조한다. 일본어 값이 영어 값(또는 영어 원문 키)과 같으면 번역하지 않고
복사한 것으로 본다. 번역 제외(`shouldTranslate: false`, Android `translatable="false"`)와 영어·일본어 동일 값은
글자가 없는 문자열과 검사 코드에 적은 언어 중립 키(브랜드·언어 자기 이름·문서 이름)만 허용한다. 각 번역의 줄바꿈 수를 유지한다.
시작 화면처럼 강조 단어 앞뒤를 이어 붙이는 문장은 조각 전체의 줄바꿈 수를 비교한다(언어별 어순에 따라 위치는 달라질 수 있다).
Shared의 키는 두 타깃에 있어야 한다. 한글이 포함됐는지를 오류 노출 기준으로 삼는 게이트도 금지한다
(`containsKorean`·`가-힣` 범위·`AC00`뿐 아니라 `\p{IsHangul}`·`UnicodeBlock.HANGUL_SYLLABLES` 같은 표기도).

컴파일러를 대체하는 검사가 아니다 — 증명하지 않는 범위는 스크립트 머리말의 「Known limitations」에 적었다. 새 래퍼나 복잡한 표현식은 실제 렌더 경로를 확인하고 분석 규칙과
`--self-test`를 함께 고친다. `scripts/hangul-literal-allowlist.txt`는 저장값·시드·생성 데이터·로그·
미리보기·언어의 자기 이름·언어와 무관한 브랜드·TTS 입력·비노출 진단에만 사유를 붙여 허용한다. 허용은 경로와
리터럴로 정하므로, 같은 값이 `String(localized:)` 같은 번역 조회에 쓰인 자리에는 적용하지 않는다(그 조회는 키를 찾아야 한다).
표시 자리(`Text(verbatim:)`·`Text(…)` 등 확정 싱크)에 바로 놓인 값에도 적용하지 않는다 — 브랜드·언어 자기 이름처럼
그대로 보여 주는 분류(`language-neutral`·`endonym`)만 예외다.
코드에서 사라진 허용 항목은 검사가 실패하므로 함께 지운다. `*` 항목은 그 파일의 리터럴만 허용하고,
언어 게이트는 별도의 `language-gate` 항목 없이는 허용하지 않는다. 사용자 화면 문구를
미번역 상태로 허용하지 않는다. 번역 리소스(XML)와 카탈로그는 허용목록에 올릴 수 없다 — 키 단위 예외는
빈 값·한글·서식 검사까지 함께 끄므로, 예외는 검사 코드에 그 항목만 좁혀 둔다. `scripts/hangul-literal-baseline.txt`는 수동 검토한 분석 예외의
경로와 리터럴 해시를 기록하는 기준선이다. 새 항목을 추가하지 않으며, 코드에서 사라진 항목도
검사가 실패하므로 함께 지운다. 초기 기준선은 비어 있다.

## 구현 지도

화면 호출부 연결은 영역별로 진행한다. 이 문서가 생겼다는 것만으로 번역 완료를 뜻하지 않는다.

| 규칙 | Android | iOS |
| --- | --- | --- |
| 번역 원문·용어 | `app/src/main/res/values{,-en,-ja}/strings.xml` | `AlarmTalk/Localizable.xcstrings` |
| 공통 오류 코드 | `network/ApiErrorMessages.kt` | `APIErrorMessages.swift` |
| 존칭 한 번(이름이 님·さん으로 끝나면 그대로, 이름을 모르면 '상대') | `data/ReceivedAlarmLabels.kt`의 `honoredPersonName`(`r3data_honorific_name`) — 받은 알람 라벨·알림 제목·가족 알람 완료·공유받은 목소리 · `HonorificNameTest` | `personDisplayName`(`%@님` 카탈로그 키) |
| 스낵바 색은 문구 종류로 | `ui/app/SnackbarSeverity.kt`의 `SnackbarSeverities` · `SnackbarSeverityTest` | (스낵바 색 구분 없음) |
| 언어 선택지 자기 이름 | `voices_lang_ko`·`voices_lang_en`·`voices_lang_ja` | 목소리 등록 화면의 언어 선택지(후속 연결) |
| 가족 알람 녹음 기본 라벨(전송은 계약값, 표시는 받는 기기 언어) | `data/ReceivedAlarmLabels.kt`의 `FAMILY_VOICE_DEFAULT_LABEL`·`localizedReceivedVoiceText` → `RingingActivity` | `ReceivedVoiceTextDisplay`·`LocalAlarmRecord.localizedVoiceText` → `AlarmKitViewModel`의 Live Activity 문구 |
| 관계는 목록에 표시하지 않는다(입력·저장·전송만) | 목소리 탭 `VoiceProfileRowComponents.kt`의 `voicesr_sharing_badge`·편집기 `VoiceAudioCard.kt`의 `ownedVoiceDetail`·알람 행 `AlarmListScreen.kt`의 `voiceName` | `ownVoiceRowSubtitle`·`ownVoiceOptionDetail`·`alarmRowVoiceName`(`LocalizedDisplay.swift`) · `VoiceLocalizationTests` |
| 저장값과 기본 목소리의 표시 | `fortuneValueLabel`·`systemVoiceDisplayName` | `FortunePromptInputFormat.displayLabel`·`systemVoiceDisplayName`·`VoiceRelationshipPreset.displayLabel` |
| 약관 웹 링크의 앱 언어 | 설정 화면의 언어별 경로 | `LegalLinks`(후속 화면에서 채택) |
| 화면의 문자열 조회 | `stringResource`·`Context.getString` | `String(localized:)`·SwiftUI의 정적 문자열 키 |
| OS가 보관하는 알람 표시 문구의 언어 재예약(§5) | 해당 없음 — 울릴 때 표시를 만든다(`RingingActivity`) | 대상 `AlarmPresentationLanguage.pending`(녹음 문구 표시 `voiceCaptionOutdated` → 알람별 기록 우선) → `AlarmScheduleReconciler.reconcile`(AlarmKit 대기 상태만 — `AlarmKitViewModel.idleScheduledHandles`) · 완료 `AlarmPresentationLanguage.finishIfComplete` · 지울 때 `LocalAlarmStore.delete` → `AlarmPresentationLanguage.forget` — 회귀 `AlarmKitLocalizationTests` |
