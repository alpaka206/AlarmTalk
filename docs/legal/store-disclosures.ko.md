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
- Audio files: 녹음/업로드 음성, 생성 음성
- App activity: 알람 생성/수정/완료, 음성 생성, 공유 기능 사용
- App info and performance: 오류 로그, 진단 정보, 앱 버전
- Device or other IDs: 푸시 토큰을 도입하는 경우, 기기/설치 식별자
- Purchase history: 구독/이용권 상태, 결제 제공자 거래 식별자
- User content: 알람 문구, TTS 문구, 음성 메시지, 문의 내용

목적:

- App functionality
- Account management
- Developer communications
- Fraud prevention, security, and compliance
- Analytics
- Personalization, only for in-app alarm/voice experience

공유 여부:

- Cloudflare, Turso, Perso(이스트소프트), Sentry, Google, Apple, 이메일 발송 제공자, payment providers are processors/service providers. Google Play form의 "sharing" 정의에 따라 최종 판단해야 합니다.
- 광고 네트워크 또는 데이터 브로커에 제공하지 않는다면 "advertising or marketing sharing"은 아니라고 보는 방향이 합리적입니다.
- ⚠️ Perso(이스트소프트)는 약관·방침상 제출된 입력 데이터(음성 포함)를 제공자 측 서비스 개선 및 AI 모델 학습에 이용할 수 있습니다. Google Play Data safety에서 audio/user content 항목의 목적에 이를 정확히 반영하고, 앱 내 음성 동의 화면에 AI 학습 이용 및 거부 경로(거부 시 기능 제한)를 고지해야 합니다.

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
- User Content: audio data, uploaded files, messages, support content
- Identifiers: user ID, app account ID
- Purchases: subscription or entitlement status if in-app purchases are enabled
- Usage Data: product interaction, alarm events, voice generation events
- Diagnostics: crash data, performance data

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
