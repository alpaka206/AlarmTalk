# Google Play / App Store 제출 체크리스트

이 문서는 스토어 제출 전 개인정보 표시를 맞추기 위한 운영 체크리스트입니다. 실제 제출 시점의 SDK, 서버, 국가, 요금제, 결제 제공자에 맞게 최종 확인해야 합니다.

## 1. 공개 URL

- Privacy Policy URL: `https://alarm-talk.com/ko/privacy/`
- Terms URL: `https://alarm-talk.com/ko/terms/`
- Support URL: `https://alarm-talk.com/ko/contact/`
- Account deletion URL: `https://alarm-talk.com/ko/account-deletion/`
- App account deletion path: 앱 설정 > 계정 > 회원 탈퇴

## 2. Google Play Data safety 예상 항목

수집 여부는 "예"로 신고하는 것이 안전합니다.

- Personal info: 이메일, 이름/닉네임, 사용자 ID
- Personal info (기타): 성별, 생년월일·출생 시각 — 운세 문구 기능 사용 시에만 수집(동적 문구 생성용, Google Vertex 미국으로 전송)
- Audio files / Voice (민감정보·생체정보): 녹음/업로드 음성, 음성 클론(생체) 데이터, 생성 음성. Play Data safety의 "Audio > Voice or sound recordings"로 신고하고, 음성 클론이 생체정보임을 앱 내 별도 동의로 고지
- App activity: 알람 생성/수정/완료, 음성 생성, 공유 기능 사용
- App info and performance: 오류 로그, 진단 정보, 앱 버전
- Device or other IDs: 푸시(FCM) 사용 시 기기 푸시 토큰, 기기/설치 식별자
- Purchase history: 구독/이용권 상태, 결제 제공자 거래 식별자(Google/Apple IAP, PortOne(아임포트) payment_id)
- User content: 알람 문구, TTS 문구, 음성 메시지, 문의 내용

목적:

- App functionality
- Account management
- Developer communications
- Fraud prevention, security, and compliance
- Analytics
- Personalization, only for in-app alarm/voice experience

공유 여부:

- Cloudflare, Turso, Perso(이스트소프트), Google Cloud Vertex AI(미국), Firebase Cloud Messaging(Google), PortOne(아임포트), Sentry, Google, Apple, 이메일 발송 제공자, payment providers are processors/service providers. Google Play form의 "sharing" 정의에 따라 최종 판단해야 합니다.
- 광고 네트워크 또는 데이터 브로커에 제공하지 않는다면 "advertising or marketing sharing"은 아니라고 보는 방향이 합리적입니다.
- ⚠️ Perso(이스트소프트)는 약관·방침상 제출된 입력 데이터(음성 포함)를 제공자 측 서비스 개선 및 AI 모델 학습에 이용할 수 있습니다. Google Play Data safety에서 audio/user content 항목의 목적에 이를 정확히 반영하고, 앱 내 음성 동의 화면에 AI 학습 이용 및 거부 경로(거부 시 기능 제한)를 고지해야 합니다.
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

## 3. Apple App Privacy 예상 항목

Data Linked to the User:

- Contact Info: email address
- Sensitive Info: voice/audio data treated as biometric (voice clone), and fortune inputs (gender, date of birth, time of birth) collected only when the fortune feature is used
- User Content: audio data, uploaded files, messages, support content
- Identifiers: user ID, app account ID, device push token (when FCM push is enabled)
- Purchases: subscription or entitlement status if in-app purchases are enabled (Apple/Google IAP, PortOne for KR web payments)
- Usage Data: product interaction, alarm events, voice generation events
- Diagnostics: crash data, performance data

> Note: Dynamic alarm-text generation/translation and fortune text generation send alarm text and fortune inputs (gender/DOB/time of birth) to Google Cloud Vertex AI (US). Disclose the cross-border transfer and surface the in-app overseas-transfer consent.

Data Not Linked to the User:

- Aggregate analytics only if truly aggregated and not linkable

Tracking:

- Set "No" unless the app uses data to track users across third-party apps/websites or uses advertising identifiers. If any ad SDK or cross-app tracking is added later, update this.

Privacy policy:

- Must be linked in App Store Connect metadata.
- Must be accessible inside the app, for example Settings > Legal > Privacy Policy.
- Responses must stay accurate when SDKs or backend providers change.

## 4. In-app Required Legal Surfaces

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
- Marketing consent toggle, if marketing is shipped
- Family/partner sharing toggle and group exit

Account deletion:

- Must describe data deleted, data retained, retention period, and irreversible impact.

## 5. Final Legal Review Questions

- Is the final app targeted to users under 14 or likely to be used by children?
- Is voice data legally treated as biometric information in the launch jurisdictions?
- Perso(ESTsoft) uses submitted voice/audio for provider-side model training and quality improvement (stated in Perso's terms/privacy policy). Confirm the in-app voice consent and Data safety form accurately disclose this, and that the AI-learning opt-out path (with feature-limit notice) is surfaced.
- Are all provider DPAs and cross-border transfer notices in place?
- Does account deletion delete R2 objects and provider-side cloned voice IDs?
- Does the app provide a way to withdraw voice sharing consent?
- Are app screenshots and store descriptions clear that AI voice cloning is user-initiated?
- Are refund, subscription, and plan downgrade effects accurately disclosed?
- Are the server-enforced consents (`voice_biometric`, `overseas_transfer`) surfaced in-app at the right moments (voice clone, dynamic/translation/fortune), matching the backend gates?
- Does the Data safety / App Privacy disclosure cover fortune birth data → Google Vertex (US), and the device push token via FCM, consistently with privacy-policy §5?
