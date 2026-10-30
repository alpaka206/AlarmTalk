# Google Play 제출 체크리스트

이 문서는 Play Console 제출 전 개인정보 표시를 맞추기 위한 운영 체크리스트입니다. 실제 제출 시점의 SDK, 서버, 국가, 요금제, 결제 제공자에 맞게 최종 확인해야 합니다.

> ⚠ iOS 앱은 2026-09-22 에 App Store 에 게재됐습니다. App Store 의 개인정보 표시는 이 문서가 아니라 App Store Connect 의 **App Privacy(영양성분표)** 에 게시돼 있고(2026-09-14 게시), 항목 구분이 Play Data safety 와 다릅니다(예: Apple 은 'Data Used to Track You' 를 따로 묻습니다). 아래 §2 는 Play 기준이므로 그대로 옮겨 쓰지 말 것. **수집·공유 항목을 바꾸면 Play Data safety 와 App Privacy 를 함께 고칩니다** — 한쪽만 고치면 두 스토어가 같은 앱을 다르게 신고하게 됩니다.

> ⚠ 2026-10-20 커플·가족 이용권과 함께 가족/파트너 그룹·초대 코드·음성 공유·가족 알람을 없앴다(처리방침 7판). 실제 양식에는 그 기능의 항목이 없다(아래 §0, 2026-10-30 확인).

## 0. 실제 양식 대조 (2026-10-30)

아래 §2 는 예상 항목이고, 이 절은 게시된 양식을 읽은 결과다. 양식은 고치지 않고 읽기만 했다.
Play 게시값은 로그인 없이 볼 수 있다(`https://play.google.com/store/apps/datasafety?id=com.alarmtalk.app&hl=ko`).
App Privacy 의 유형·목적은 App Store Connect 의 '앱이 수집하는 개인정보' 에서 본다.

**두 양식 모두 알람 설정을 수집 항목으로 적지 않았다.** 서버 알람 사본 삭제(2026-10-29)로 지울 항목은 없다.

### Play 데이터 보안 — 실제보다 적게 신고돼 있다

게시된 내용은 수집 2개(이메일 주소·사용자 ID, 앱 기능·계정 관리)와 공유 1개(대략적인 위치, 앱 기능)뿐이다.
같은 앱의 App Privacy(13개 유형)·처리방침과 어긋나고, 지금 게재된 앱도 아래 항목을 이미 처리한다. **1.3 심사 전에** 고친다.

| Play 항목 | 실제 처리하는 것 | 필수·선택 | 목적 |
| --- | --- | --- | --- |
| 개인 정보 > 사용자 ID (있음) | 목적만 더한다. 사용 기록이 사용자별이다 | 필수 | 앱 기능·계정 관리 + **분석** |
| 개인 정보 > 기타 정보 | 성별·생년월일·출생 시각(운세 문구) | 선택 | 앱 기능·맞춤설정 |
| 금융 정보 > 구매 내역 | 구독 상태·거래 식별자, 구매 확인 기록 | 선택 | 앱 기능·분석 |
| 오디오 > 음성 또는 사운드 녹음본 | 녹음·업로드 음성, 생성 음성 | 선택 | 앱 기능 |
| 앱 활동 > 앱 상호작용 | 사용 기록(`docs/spec/usage-events.md`) | 필수 | 앱 기능·분석 |
| 앱 활동 > 기타 사용자 제작 콘텐츠 | 직접 입력 문구, 목소리 이름 | 선택 | 앱 기능 |
| 앱 정보 및 성능 > 비정상 종료 로그 | Sentry | 필수 | 앱 기능 |
| 앱 정보 및 성능 > 진단 | Sentry, 음성 준비 시간·오류 코드 | 필수 | 앱 기능·분석 |
| 기기 또는 기타 ID | FCM 푸시 토큰 | 필수 | 앱 기능 |
| 위치 > 대략적인 위치 (공유만 있음) | 사용자가 고른 나라·도시. 서버로 보내므로 **수집도 표시**한다 | 선택 | 앱 기능·맞춤설정 |

전부 '수집' 이다. ElevenLabs·Google Vertex·Sentry 등은 서비스 제공자라 '공유' 로 올리지 않는다(§2). 광고 항목은 광고를 켜는 회차에 더한다(§2).

### App Privacy — 1.3 게재와 함께 두 가지만 고친다

게시된 13개 유형은 처리방침과 맞는다. 고칠 것은 둘이다. 앱의 `PrivacyInfo.xcprivacy` 는 먼저 고쳐 두었으니 양식만 맞추면 된다.

- **`이름` 을 지운다** — 닉네임 삭제(2026-10-29)로 1.3 은 이름을 묻지도 보내지도 않는다.
- **`구입 내역` 에 분석 목적을 더한다** — 8판의 사용 기록이 구매 확인 결과·이용권 변경을 운영 점검에 쓴다.

App Privacy 는 저장하는 즉시 공개되므로 1.3 게재 전에 미리 고치지 않는다.

## 1. 공개 URL

- Privacy Policy URL: `https://alarm-talk.com/ko/privacy/`
- Terms URL: `https://alarm-talk.com/ko/terms/`
- Support URL: `https://alarm-talk.com/ko/contact/`
- Account deletion URL: `https://alarm-talk.com/ko/account-deletion/`
- App account deletion path: 앱 설정 > 계정 > 회원 탈퇴

## 2. Google Play Data safety 예상 항목

수집 여부는 "예"로 신고하는 것이 안전합니다.

- Personal info: 이메일, 사용자 ID(이름·닉네임은 2026-10-29 부터 받지 않는다)
- Personal info (기타): 성별, 생년월일·출생 시각 — 운세 문구 기능 사용 시에만 수집(동적 문구 생성용, Google Vertex 미국으로 전송)
- Audio files / Voice (민감정보·생체정보): 녹음/업로드 음성, 음성 클론(생체) 데이터, 생성 음성. Play Data safety의 "Audio > Voice or sound recordings"로 신고하고, 음성 클론이 생체정보임을 앱 내 별도 동의로 고지
- App activity: 알람 생성/수정/삭제, 음성 생성
- App info and performance: 오류 로그, 진단 정보, 앱 버전
- Device or other IDs: 푸시(FCM) 사용 시 기기 푸시 토큰, 기기/설치 식별자
- Purchase history: 구독/이용권 상태, 인앱결제 거래 식별자(Google Play=구매 토큰·주문 ID, App Store=transaction id·original transaction id)
- User content: 알람 문구, TTS 문구, 음성 메시지, 문의 내용

목적:

- App functionality
- Account management
- Developer communications
- Fraud prevention, security, and compliance
- Analytics
- Personalization, only for in-app alarm/voice experience

공유 여부:

- Cloudflare, Turso, ElevenLabs, Google Cloud Vertex AI(미국), Firebase Cloud Messaging(Google), Sentry, Google(로그인·배포·결제), 이메일 발송 제공자는 수탁사/서비스 제공자입니다. Google Play form의 "sharing" 정의에 따라 최종 판단해야 합니다.
- 광고 네트워크 또는 데이터 브로커에 제공하지 않는다면 "advertising or marketing sharing"은 아니라고 보는 방향이 합리적입니다.
- ⚠️ **보상형 광고를 켜는 회차에 이 표를 다시 쓴다**(처리방침 8판 1.9·제5조, `docs/spec/ad-rewards.md` §6). 광고 SDK(Google AdMob·UMP)가
  Device or other IDs(Android 광고 ID), Approximate location(IP 기반), App interactions(광고 노출·클릭), Diagnostics 를 처리하고,
  목적에 Advertising or marketing·Fraud prevention 이 붙는다. 그때는 위 줄("광고 네트워크에 제공하지 않는다")이 더 이상 참이 아니다.
  앱 매니페스트의 `AD_ID` 제거 줄을 지우는 것도 그 회차다. 광고를 켜기 전(지금)의 신고는 위 그대로다.
- 처리방침 8판에서 늘어난 App activity: 음성 준비 시간·용량, 알람 저장 과정과 고른 문구 종류, 결제 화면·구매 확인 결과, 기능 사용 여부(사용 기록 2판).
- 처리방침 8판에서 줄어든 것: **알람 설정은 서버에 두지 않는다**(2026-10-29, 1.2). 실제 양식에는 알람 설정을 수집으로 적은 항목이 없어 지울 것이 없다(§0).
  사용 기록의 알람 생성·수정·삭제 시각(App activity)은 계속 수집한다.
- ⚠️ ElevenLabs 처리 조건은 실제 적용 계약·정책·DPA·보관 설정에 맞춰 Google Play Data safety의 audio/user content 항목과 앱 내 음성 동의 화면에 반영해야 합니다.
- ⚠️ 동적 알람 문구·번역 사용 시 알람 문구와 운세 입력값(성별·생년월일·출생 시각)이 Google Cloud Vertex AI(미국)로 전송됩니다. Personal info(생년월일 등) 및 User content(알람 문구)의 국외 처리/공유 항목에 반영하고, 앱 내에 국외 이전 별도 동의(`overseas_transfer`)를 고지해야 합니다.
- ⚠️ 음성 클론은 생체정보 처리에 해당하므로, 앱 내 별도 동의(`voice_biometric`)가 서버에서 강제됩니다. Data safety의 audio/voice 항목과 in-app 동의가 이를 일치하게 반영해야 합니다.

보안:

- Data encrypted in transit: Yes
- User can request data deletion: Yes, if account deletion flow is shipped
- Data encrypted at rest: Cloud/provider and database configuration final verification required

Prominent disclosure and consent:

- Voice recording/upload and AI voice generation require in-app prominent disclosure before permission or upload.
- Microphone permission prompt must not appear before explaining why the app records audio.
- Background/restricted permission use must be explained before OS permission screens.

## 3. In-app Required Legal Surfaces

Onboarding:

- Terms agreement
- Privacy Policy agreement
- Age 14+ or legal guardian consent confirmation

Voice feature:

- Separate voice/AI consent before recording, upload, speaker separation, clone, or TTS
- Statement that the user must own or have permission to use the voice
- Statement that voice recordings, scripts, and generated voice rights remain with the user or original rights holder
- Statement that the user is responsible for unauthorized voice registration, copyright/personality-right violations, impersonation, fraud, harassment, and illegal use
- Statement that generated voices must not be used for impersonation, fraud, harassment, or illegal acts

Settings:

- Privacy Policy
- Terms
- Manage voice profiles
- Delete account
- Marketing consent toggle (`더보기 > 설정 > 법적 정보 > 약관 및 개인정보 처리 동의 > 선택 동의`)

Account deletion:

- Must describe data deleted, data retained, retention period, and irreversible impact.

## 4. Final Legal Review Questions

- Is the final app targeted to users under 14 or likely to be used by children?
- Is voice data legally treated as biometric information in the launch jurisdictions?
- Does the ElevenLabs contract/DPA and retention setting match the in-app voice consent, Data safety form, and privacy-policy processor table?
- Are all provider DPAs and cross-border transfer notices in place?
- Does account deletion delete R2 objects and provider-side cloned voice IDs?
- Are app screenshots and store descriptions clear that AI voice cloning is user-initiated?
- Are refund, subscription, and plan downgrade effects accurately disclosed?
- Are the server-enforced consents (`voice_biometric`, `overseas_transfer`) surfaced in-app at the right moments (voice clone, dynamic/translation/fortune), matching the backend gates?
- Does the Data safety disclosure cover fortune birth data → Google Vertex (US), and the device push token via FCM, consistently with privacy-policy §5?
