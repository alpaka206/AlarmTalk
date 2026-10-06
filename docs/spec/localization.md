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

이 기능의 첫 실행에는 기존 받은 알람의 자동 라벨이나 가족 알람 녹음의 기본 라벨(§2)의 표시가 현재 언어와 다른 경우만 고친다. 받은 알람의
자동 라벨은 세 언어의 정확한 문장 틀과 일치할 때만 표시를 다시 만들고, 직접 고친 라벨과 저장값은
보존한다.

번역 누락 검사는 사용자에게 보이는 문자열을 대상으로 한다. 로그·테스트·사용자 입력·데이터 계약값·
TTS 입력 문장은 구분한다. 카탈로그의 번역 유무와 호출부가 실제로 번역을 조회하는지를 모두 본다.
각 화면의 변경에서 같은 화면의 두 앱 문구, 자리표시자, 영어·일본어의 레이아웃을 확인한다.
같은 시각 알람 교체 확인은 두 앱 모두 시각만 넣어 묻는다(「HH:mm 알람을 새 알람으로 교체할까요?」).
운세 입력 카드와 시트의 이름은 「운세 정보」로 맞춘다.
스토어의 앱 화면 언어 지원 문장은 전체 화면의 번역 누락을 처리한 뒤 복원한다.

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
| OS가 보관하는 알람 표시 문구의 언어 재예약(§5) | 해당 없음 — 울릴 때 표시를 만든다(`RingingActivity`) | 대상 `AlarmPresentationLanguage.pending`(알람별 기록 우선) → `AlarmScheduleReconciler.reconcile`(AlarmKit 대기 상태만 — `AlarmKitViewModel.idleScheduledHandles`) · 완료 `AlarmPresentationLanguage.finishIfComplete` · 지울 때 `LocalAlarmStore.delete` → `AlarmPresentationLanguage.forget` — 회귀 `AlarmKitLocalizationTests` |
