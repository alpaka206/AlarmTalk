> ⚠️ 아카이브(2026-07-15): iOS 패리티 정비(2026-06-28) 이전 스냅샷. 현행 iOS 상태 아님.

# iOS ↔ Android 1:1 패리티 감사 보고서

> Android(`apps/android-native`, Kotlin/Compose)를 **기준(baseline)**으로 iOS(`apps/ios-native`, SwiftUI)가 로직·통신·UI·스타일에서 얼마나 일치하는지 14개 영역으로 나눠 비교. 통신 계약은 `packages/shared` + `packages/backend/src/routes`를 진실로 간주. high/critical 발견은 별도 에이전트가 적대적으로 재검증.

- 총 발견: **136건** / high·critical 확정: **30건**
- 영역: 14개

범례: 🔴 critical · 🟠 high · 🟡 medium · ⚪ low · ✅ 재검증 확정 · ❌ 재검증 기각

---

## [api-contract] Networking & wire contract — `major-gaps`

iOS's networking layer is largely a faithful port of Android's (base URL normalization, Bearer auth, X-App-Platform/X-App-Version headers, 60s timeouts, 401 debounced sign-out, 403 CONSENT_REQUIRED handling, snake_case JSON, multipart upload all match). However there are real divergences. The single biggest one is a fully stale Character/Growth networking surface on iOS (getCharacter + grantCharacterXP hitting /characters/* endpoints that the backend deleted and Android fully removed), which is actively fired on wake and app launch. Beyond that, iOS is missing several endpoints Android ships (password reset, family-share regenerate, GET consents), and the voice-clone request omits the voiceGender/speechFormality fields Android always sends, so iOS-cloned voices lose gender/Japanese-formality control. A few response models and a debug field also diverge from the backend contract. Overall: major gaps.

### 🔴 Stale Character/Growth API surface still present and actively called on iOS ✅(high, 실제 high)
- **분류**: stale-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/network/AlarmTalkApi.kt:3-12 (no Character API in the aggregated interface); backend has no /characters route`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmTalkAPI.swift:494-535 (getCharacter -> "characters/me", grantCharacterXP -> "characters/xp"); models AlarmTalkAPIModels.swift:713-778; wired at AlarmTalkApp.swift:155,202 and SocialFeatureViewModel.swift:830`
- **차이**: The Character/Growth feature was removed from Android (FE+BE) and the backend `/characters/me` and `/characters/xp` routes no longer exist (grep of packages/backend/src/routes finds zero matches). iOS still defines `getCharacter` and two `grantCharacterXP` overloads plus the full Character* model set, and they are not dead code: CharacterEventStore.flushPending() runs on app launch/foreground (AlarmTalkApp.swift:155,202) and SocialFeatureViewModel.swift:830 calls grantCharacterXP(event:"wake_success") on alarm dismissal. Every one of these requests now hits a non-existent route and fails.
- **수정안**: Delete getCharacter, both grantCharacterXP methods, the CharacterXPGranting conformance, and all Character* request/response structs from AlarmTalkAPI.swift/AlarmTalkAPIModels.swift, and remove CharacterEventStore/CharacterEventEntity/GrowthPanel and their call sites (AlarmTalkApp.swift, SocialFeatureViewModel.swift, AlarmAppContext.swift) so iOS matches Android's removal.

### 🟠 Voice clone request omits voiceGender and speechFormality fields ✅(high)
- **분류**: missing-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/network/VoiceProfileApi.kt:106-121 (createVoiceClone sends @Part("voiceGender") and @Part("speechFormality")); caller VoiceProfileManagementPanel.kt:340,965-966 sends real values (gender default "neutral"; "polite"/"auto")`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmTalkAPI.swift:109-131 (voiceCloneMultipartFields) and 133-165 (cloneVoice)`
- **차이**: Android always sends multipart fields `voiceGender` (male/female/neutral) and `speechFormality` (auto/polite, the Japanese-politeness toggle) on POST /voice/clone, and the backend persists them (voice-profile.ts:696-706, 795-808) to drive synthesis. iOS's `voiceCloneMultipartFields` only sends name/isShared/durationMs/relationshipLabel/listenerTitle/isDraft (plus an unused noiseRemoval flag the backend does not read), so iOS-cloned voices are always stored with null voice_gender/speech_formality and behave differently in TTS. The clone UI control for gender/formality is therefore unenforceable on iOS.
- **수정안**: Add `voiceGender` and `speechFormality` parameters to cloneVoice/voiceCloneMultipartFields and always include them as multipart fields (default "neutral" and "auto") matching Android, and surface the gender/Japanese-polite selection in the iOS clone flow. Drop the noiseRemoval/noise_removal fields the backend ignores.

### 🟡 VoiceProfileUpdateRequest cannot edit voice_gender / speech_formality
- **분류**: contract-mismatch
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/network/VoiceProfileApi.kt:53-63 (voice_gender, speech_formality on VoiceProfileUpdateRequest)`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmTalkAPIModels.swift:373-394 (no voiceGender/speechFormality); AlarmTalkAPI.swift:254-276 (updateVoiceProfile)`
- **차이**: The backend PATCH /voice/:id accepts and updates voice_gender and speech_formality (voice-profile.ts:401-409,518-525). Android's VoiceProfileUpdateRequest includes both fields; iOS's omits them, so iOS users cannot change a saved voice's gender or Japanese-formality after creation, unlike Android.
- **수정안**: Add `voiceGender: String?` and `speechFormality: String?` to VoiceProfileUpdateRequest and thread them through updateVoiceProfile(...), encoding as voice_gender/speech_formality.

### 🟡 Password reset endpoints not implemented on iOS
- **분류**: missing-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/network/AuthApi.kt:200-206 (requestPasswordReset -> auth/password-reset, confirmPasswordReset -> auth/password-reset/confirm); wired MainViewModelAuthActions.kt:203-212`
- **iOS**: `n/a (missing) — no equivalent method in apps/ios-native/AlarmTalk/AlarmTalkAPI.swift`
- **차이**: iOS supports email/password login and registration (loginWithEmail, register) but provides no password-reset request/confirm calls, while Android ships both and the backend implements them (auth.ts:280, 359). Email/password iOS users have no way to recover an account.
- **수정안**: Add requestPasswordReset(email:) -> POST auth/password-reset and confirmPasswordReset(email:code:password:) -> POST auth/password-reset/confirm with request bodies matching Android's PasswordResetRequest/PasswordResetConfirmRequest, and wire a forgot-password flow.

### 🟡 Family-share code regenerate endpoint missing on iOS
- **분류**: missing-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/network/BillingApi.kt:150-153 (regenerateFamilyShareCode -> POST billing/vouchers/family-share/regenerate); UI MemberManagementScreen.kt:249-342, MainViewModelGrowthBillingActions.kt:526`
- **iOS**: `n/a (missing) — AlarmTalkAPI.swift only has ensureFamilyShareCode (598-605)`
- **차이**: Android exposes a 'Regenerate code' security action that invalidates a leaked family invite code and issues a new one (backend billing-mutation.ts:641). iOS only has ensureFamilyShareCode and no regenerate method or UI, so iOS family owners cannot revoke a leaked code.
- **수정안**: Add regenerateFamilyShareCode(token:) -> POST billing/vouchers/family-share/regenerate returning EnsureFamilyShareCodeResponse, and add the regenerate action to the iOS member-management screen to match Android.

### 🟡 FamilyAlarmTalkResponse decodes into RemoteAlarm whose field names don't match the backend payload
- **분류**: contract-mismatch
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/network/FamilyApi.kt:51-60 (FamilyAlarmTalk with recipient_user_id, wake_at, mode)`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmTalkAPIModels.swift:999-1001 (FamilyAlarmTalkResponse { alarm: RemoteAlarm })`
- **차이**: POST /family/alarms/voice returns alarm = { id, sender_user_id, recipient_user_id, wake_at, repeat_days, mode, voice_upload_id } (family-alarm.ts:373-393). Android decodes this into a purpose-built FamilyAlarmTalk model whose keys (recipient_user_id, wake_at) match. iOS decodes it into RemoteAlarm, whose corresponding properties are `time` and `targetUserId` (mapped to `time`/`target_user_id`), so wake_at and recipient_user_id silently decode to nil. Decoding doesn't fail because the fields are optional, but the response time/recipient are lost.
- **수정안**: Introduce a dedicated FamilyAlarmTalk model on iOS with fields id, recipientUserId(recipient_user_id), wakeAt(wake_at), mode (matching Android) and use it as FamilyAlarmTalkResponse.alarm instead of RemoteAlarm.

### ⚪ Email verification response reads wrong debug-code key and drops expires_in_seconds
- **분류**: contract-mismatch
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/network/AuthApi.kt:81-85 (expires_in_seconds, debug_code)`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmTalkAPIModels.swift:962-966 (RequestEmailVerificationResponse { success, devCode })`
- **차이**: The backend returns { success, expires_in_seconds, debug_code? } for auth/email-code and auth/password-reset (auth.ts:188-191, 297-302). iOS's model field `devCode` decodes from `dev_code` (via convertFromSnakeCase), not `debug_code`, so iOS never receives the dev convenience code, and it omits expires_in_seconds entirely. Android maps both correctly. Low impact (debug_code only surfaces in dev), but it is a contract mismatch.
- **수정안**: Rename the field so it decodes from debug_code (e.g. add CodingKeys mapping debugCode -> debug_code) and add expiresInSeconds: Int? to match Android.

### ⚪ GET /user/consents (list consents) not implemented on iOS
- **분류**: missing-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/network/AuthApi.kt:245-246 (listConsents); used MainViewModelAuthActions.kt:641`
- **iOS**: `n/a (missing) — iOS has consentStatus and recordConsents but no listConsents`
- **차이**: Android can fetch the user's recorded consent history via GET /user/consents (backend user.ts:401) to display current agreement state; iOS only calls /user/consents/status and POST /user/consents, so it cannot show the detailed per-type consent records Android does.
- **수정안**: Add listConsents(token:) -> GET user/consents returning a ConsentListResponse ([{ consent_type, policy_version, agreed, agreed_at }]) to mirror Android.

### ⚪ iOS exposes networking calls and request fields Android never sends
- **분류**: stale-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/network/FamilyApi.kt:72-95 (no transfer-ownership, no speaker GET/PATCH/diarize); FamilyApi.kt:43-49 (FamilyAlarmTalkRequest has no dub_target_language)`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmTalkAPI.swift:680-688 (transferFamilyOwnership), 197-252 (getVoiceUploadSpeakers/updateVoiceUploadSpeaker/diarizeVoice), 715-723 (redeemVoucher); AlarmTalkAPIModels.swift:990-997 (dub_target_language)`
- **차이**: iOS defines several endpoints Android's API layer does not call: family transfer-ownership, voice-upload speakers GET, speaker-rename PATCH, /voice/diarize, billing/redeem, and an extra dub_target_language field on the family-alarm request. The backend supports all of these (family-group.ts:143, voice-upload.ts:260/289/340, billing-mutation.ts:427), but because Android (the baseline) neither calls them nor exposes the corresponding UX, they are parity divergences; several (e.g. searchUsers, transferFamilyOwnership) appear to be unused/dead surface per their own comments, while the speaker-rename/diarize calls imply an iOS voice flow richer than Android's single /separate call. dub_target_language is encoded only when non-nil so it is harmless when unset.
- **수정안**: Decide per-call: remove genuinely unused methods (transferFamilyOwnership, redeemVoucher, searchUsers if no call sites) to shrink drift, and align the voice speaker-separation flow with Android (Android uses only POST /voice/uploads/:id/separate). Drop dub_target_language from FamilyAlarmTalkRequest unless Android adds the dubbing feature.

---

## [auth-session] Auth, session & version gate — `major-gaps`

iOS covers most of the auth surface (email/social login, consent gate, pending-deletion, forced-update, account deletion) and endpoint paths/request shapes match the backend and Android. However there are real, high-impact gaps: the entire password-reset flow is missing on iOS, the registration password validation drops the server-mandated letter+digit rule (and shows wrong on-screen rules), the onboarding still ships the removed Character/Growth page, and the consent-check loading gate that prevents a content flash on cold start is absent. Several lower-severity UI/structure and error-handling divergences also exist on the Landing/Login screens. Overall: major gaps that need closing before iOS behaves like Android.

### 🟠 Password reset flow entirely missing on iOS ✅(high)
- **분류**: missing-feature
- **Android**: `apps/android-native/.../ui/auth/PasswordResetScreen.kt:46-201; ui/auth/AuthScreen.kt:314-328 (onFindPassword link); ui/main/MainViewModelAuthActions.kt:203-259 (requestPasswordReset/confirmPasswordReset); network/AuthApi.kt:200-206`
- **iOS**: `n/a (missing) — AlarmTalk/Views/Auth/LoginView.swift (no find-password link); AlarmTalk/AuthViewModel.swift (no reset methods); AlarmTalk/AlarmTalkAPI.swift (no auth/password-reset calls)`
- **차이**: Android offers a full password-reset funnel: a '비밀번호 찾기' link in the login screen routes to PasswordResetScreen, which requests a 6-digit code (POST auth/password-reset) and confirms a new password (POST auth/password-reset/confirm). The backend implements both endpoints (packages/backend/src/routes/auth.ts:280-411) and the shared schemas exist (PasswordResetRequestSchema / PasswordResetConfirmRequestSchema). iOS has none of this: no find-password link in LoginView, no requestPasswordReset/confirmPasswordReset in AuthViewModel, no API methods, and no PasswordResetView. An email/password user who forgets their password is permanently locked out on iOS.
- **수정안**: Add requestPasswordReset(email) and confirmPasswordReset(email, code, password) to AlarmTalkAPI (POST auth/password-reset, POST auth/password-reset/confirm), add the corresponding AuthViewModel actions (mirroring MainViewModelAuthActions.kt:203-259, including codeSentTo state), create a PasswordResetView mirroring PasswordResetScreen.kt (email -> send code -> code+new password, password policy 8-128 + letter + digit), and add a '비밀번호 찾기' link in LoginView's login mode.

### 🟠 Register password validation omits server-required letter+digit rule; on-screen rules differ ✅(high, 실제 medium)
- **분류**: logic-diff
- **Android**: `apps/android-native/.../ui/auth/AuthScreen.kt:75-94 (passwordPolicyValid = min && max && passwordHasLetterAndDigit), :388-390 (rules: min / alnum / match)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Auth/LoginView.swift:54-73 (canSubmit uses only passwordLengthValid), :246-252 (rules: '8자 이상' / '128자 이하' / '비밀번호 확인 일치')`
- **차이**: The shared PasswordSchema (packages/shared/src/schemas/auth.ts:10-15) requires 8-128 chars AND at least one letter AND one digit. Android enforces this client-side (passwordHasLetterAndDigit gates canSubmit) and displays the rule '영문·숫자 포함'. iOS only checks length (passwordAtLeastMin && passwordUnderMax) in canSubmit and shows '128자 이하' instead of the alnum rule. Result: iOS enables 'create account' for a letters-only or digits-only password, which the server rejects with 400 AUTH_VALIDATION_FAILED, and the on-screen guidance misrepresents the actual policy.
- **수정안**: Add passwordHasLetter && passwordHasDigit checks to LoginView (compute from password) and include them in canSubmit. Replace the password rule rows with: '8자 이상', '영문·숫자 포함', '비밀번호 확인 일치' to match AuthScreen.kt:388-390.

### 🟠 Onboarding ships removed Character/Growth page (3rd page) ✅(high)
- **분류**: stale-feature
- **Android**: `apps/android-native/.../ui/onboarding/OnboardingScreen.kt:47-59 (OnboardingPages = exactly 2 pages: voice, together)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Auth/OnboardingView.swift:97-116 (3 pages; 3rd page title '알람을 끄며 함께 성장해요' / desc '하루를 시작할 때마다 캐릭터의 성장 기록이 쌓여요', useTertiary)`
- **차이**: The Character/Growth feature was removed from Android (FE+BE). Android onboarding now has only two pages (Mic/voice and Group/together), all using secondaryContainer. iOS OnboardingView still has three pages, the third being the character-growth page ('sparkles' icon, tertiaryContainer), advertising a feature that no longer exists. The file header comment even says 'three pages ... 세 번째 = 캐릭터', confirming it is stale.
- **수정안**: Remove the third OnboardingPage (character/growth) from OnboardingPage.all so only the voice and together pages remain, and drop the useTertiary branch (Android uses secondaryContainer for all pages). DotIndicator/total then naturally reflects 2 pages.

### 🟡 Missing consent-check loading gate causes content flash before consent/pending-deletion resolves on cold start
- **분류**: logic-diff
- **Android**: `apps/android-native/.../ui/app/AlarmTalkApp.kt:530-535 (ConsentCheckLoadingScreen while !consentChecked); ui/main/MainViewModelAuthActions.kt:550-580 (consentChecked + isConsentCachedDone short-circuit)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Root/RootView.swift:21-63 (no consentChecked gate); AuthViewModel.swift:88 (session set synchronously in init), :151-156 (restoreSession runs async), :553-562 (checkConsentStatus)`
- **차이**: Android holds the UI on a ConsentCheckLoadingScreen until the first consent-status check resolves (and caches consent-done per user/version), so a returning user who must re-consent never sees onboarding/home flash before the consent screen. On iOS, AuthViewModel.init reads the session synchronously so RootView immediately renders with needsConsent=false (default); checkConsentStatus only runs later inside the async restoreSession(). A returning user who needs (re-)consent will briefly see onboarding/MainTabs before ConsentView appears, and momentarily has access to gated content.
- **수정안**: Introduce a consentChecked flag on AuthViewModel set false until the first checkConsentStatus completes on restore; in RootView, show a loading view (ProgressView) while authenticated && !pendingDeletion && !consentChecked, before onboarding/MainTabs. Optionally cache consent-done per user/policyVersion to skip the loading state for already-consented users (mirroring isConsentCachedDone).

### 🟡 Duplicate-email during registration not handled; code-entry UI shown even when send failed
- **분류**: error-handling
- **Android**: `apps/android-native/.../ui/main/MainViewModelAuthActions.kt:85-128 (requestEmailVerification + duplicateEmailMessage: AUTH_EMAIL_TAKEN -> authRedirectToLogin + message; AUTH_EMAIL_SOCIAL -> apple/google-specific message); ui/auth/AuthScreen.kt:179 (code row only when codeSentForEmail set onSuccess)`
- **iOS**: `apps/ios-native/AlarmTalk/AuthViewModel.swift:227-238 (requestEmailVerification only sets generic statusMessage on error); Views/Auth/LoginView.swift:176-187 (verifyEmailRow sets verificationSent=true synchronously, regardless of result)`
- **차이**: When registering with an already-registered email, the backend returns 409 AUTH_EMAIL_TAKEN (or AUTH_EMAIL_SOCIAL+provider) from auth/email-code. Android maps these: AUTH_EMAIL_TAKEN switches the user to the login screen with a clear message, and AUTH_EMAIL_SOCIAL shows a provider-specific message; it only reveals the code-entry UI on a successful send. iOS does neither: requestEmailVerification shows only the generic fallback '인증 코드를 보내지 못했어요', and the view flips verificationSent=true immediately after dispatching the task, so the 6-digit code field appears even though no code was ever sent — leaving the user stuck entering a code that will never validate.
- **수정안**: Have requestEmailVerification inspect the API error code: on AUTH_EMAIL_TAKEN switch LoginView mode to .login + show the taken message; on AUTH_EMAIL_SOCIAL show an apple/google-specific message. Only set verificationSent=true after a successful send (await the result and gate on success), so the code-entry row is not shown on failure.

### 🟡 Landing screen auth-entry structure diverges from Android
- **분류**: ui-diff
- **Android**: `apps/android-native/.../ui/auth/LandingScreen.kt:95-166 (brand header = single 48dp logo image; bottom = two full-width stacked buttons: [로그인] filled accent + [회원가입] outlined; no SSO on landing)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Auth/LandingView.swift:62-95 (brand header = 42dp gradient waveform box + 'AlarmTalk'/'Voice alarm' text), :270-361 (LandingAuthPanel bordered card: '시작하기' header/subtitle + Apple SSO button + '이메일로 로그인' filled + divider + '처음 사용하시나요? / 계정 만들기' small bordered button)`
- **차이**: Android's landing is hero copy + preview card + two full-width stacked buttons (Login filled, Register outlined) with no social login on this screen. iOS restructures the bottom into a bordered 'auth panel' card with a '시작하기' heading/subtitle, an Apple Sign-in button, an email-login button, and a small bordered '계정 만들기' button. The brand header also differs (Android shows only a logo image; iOS adds gradient box + two text lines). This is a substantial structure/layout divergence rather than a 1:1 port.
- **수정안**: Replace the LandingAuthPanel card with two full-width stacked buttons matching Android ([로그인] filledTonal/prominent + [회원가입] outlined), remove the '시작하기' header card, and keep social (Apple) sign-in only inside the Login screen (as Android keeps Google only in the auth screen). Reduce the brand header to a single logo to match WakerBrandHeader.

### ⚪ Social sign-in shown in both login and register modes (Android shows it only in login mode)
- **분류**: ui-diff
- **Android**: `apps/android-native/.../ui/auth/AuthScreen.kt:314-355 (forgot-password row + '또는' divider + Google button wrapped in `if (mode == AuthMode.Login)`)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Auth/LoginView.swift:113-115 + 298-329 (appleSignInRow rendered unconditionally in both modes with '간편 로그인' divider)`
- **차이**: On Android the SSO section (divider + provider button) is only rendered in login mode; the register form ends at the submit button. On iOS the Apple sign-in row appears in both login and register modes.
- **수정안**: Render appleSignInRow only when mode == .login in LoginView (move it inside an `if mode == .login` block), matching AuthScreen.kt:314-355.

### ⚪ Consent policy version hardcoded on iOS instead of server-driven
- **분류**: logic-diff
- **Android**: `apps/android-native/.../ui/main/MainViewModelAuthActions.kt:591-609 (submitConsents sends version = cachedPolicyVersion(), captured from consentStatus.policyVersion)`
- **iOS**: `apps/ios-native/AlarmTalk/AuthViewModel.swift:564-583 (currentPolicyVersion = '2' hardcoded; makeConsentsRequest sends this constant for every item)`
- **차이**: The backend records whatever policy_version the client sends (user.ts:388-390) and re-prompts when version != CURRENT_POLICY_VERSION (currently '2'). Android captures the live policy version from the consents/status response and echoes it back, so it auto-tracks future bumps. iOS hardcodes '2'. Both produce '2' today, but if the backend bumps CURRENT_POLICY_VERSION (e.g. to '3'), iOS would keep recording '2' and loop the user through re-consent indefinitely, while Android adapts. (Pre-launch DB wipe limits current impact.)
- **수정안**: Store the policyVersion returned by checkConsentStatus (ConsentStatusResponse.policyVersion) on AuthViewModel and pass it into makeConsentsRequest instead of the hardcoded constant, mirroring Android's cachedPolicyVersion().

### ⚪ Consent 'agree-all' row uses smaller emphasis typography than Android
- **분류**: styling-diff
- **Android**: `apps/android-native/.../ui/auth/ConsentScreen.kt:170-173 (emphasized row uses MaterialTheme.typography.titleMedium + Bold)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Auth/ConsentView.swift:96-98 (emphasized row uses .body.weight(.bold))`
- **차이**: The '약관 전체 동의' emphasized header row is rendered with titleMedium (bold) on Android but with body (bold) on iOS, so the emphasized agree-all label is visually smaller/less prominent than on Android. iOS ConsentView also consumes static AlarmTalkTheme.* colors rather than the theme environment used by the other auth screens.
- **수정안**: Render the emphasized ConsentRow label with a titleMedium-equivalent font (e.g. theme.typography.titleMedium / .title3 weight .bold) to match ConsentScreen.kt, and consider sourcing colors from the voiceAlarmTheme environment for consistency.

---

## [voice-tts] Voice profiles, cloning, TTS & audio — `major-gaps`

The core audio infrastructure is largely a faithful port: volume-ramp curve (6s / 12 steps / 0.15 startRatio / 0.10 floor), recorder encoding (AAC 44.1kHz/128kbps), system-voice id prefix, TTS/voice-profile endpoint paths & request/response shapes, dynamic-refresh due-window math (day-before 22:00 to fire-60s), cache-key SHA-256 scheme, and stock-clip flow all match Android. However there are two functional defects: (1) iOS caps client-side voice-profile count at 5 while Android and the backend cap at 1, so the iOS UI shows 5 slots and says "최대 5개" but creation fails server-side after the first; (2) iOS is missing the entire voice-gender + Japanese-formality selection feature that Android sends at clone time and the backend persists and uses during TTS generation. Several smaller behavioral/UI divergences exist around recording auto-stop, file-crop granularity, duration tolerance, and the dynamic-refresh default context.

### 🔴 iOS max voice-profile limit is 5, but Android and backend cap at 1 ✅(high, 실제 high)
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/navigation/NavigationModels.kt:38 (MAX_VOICE_PROFILES = 1); backend packages/backend/src/routes/voice-profile.ts:15 (MAX_VOICE_PROFILES = 1)`
- **iOS**: `apps/ios-native/AlarmTalk/VoiceStudioViewModel.swift:22 (static let maxProfiles = 5)`
- **차이**: iOS VoiceProfileLimits.maxProfiles = 5 drives isProfileLimitReached, remainingProfileSlots, the slot-card UI, and the '목소리는 최대 5개까지 만들 수 있어요' / slot-exhausted messaging (e.g. VoiceCloneUploadFlow.swift:546). Android and the backend both enforce 1 (Android blocks at MainViewModelVoiceActions.kt:142 'non-system + drafts > 1'; backend returns 403 VOICE_LIMIT_REACHED at voice-profile.ts:718). On iOS a user sees up to 5 open slots and is allowed to attempt a 2nd–5th clone, but the server rejects every clone after the first, producing a confusing failure instead of the Android pre-emptive 'limit reached' state.
- **수정안**: Change VoiceStudioViewModel.swift:22 to `static let maxProfiles = 1` to match Android NavigationModels.kt and backend MAX_VOICE_PROFILES. Verify the slot-card UI and SpeakerSeparationFlow's remainingProfileSlots cap collapse to a single slot accordingly.

### 🟠 Voice gender + Japanese speech-formality selection entirely missing on iOS clone flow ✅(high, 실제 medium)
- **분류**: missing-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/voices/VoiceProfileManagementPanel.kt:209 (VoiceGenderSelector), :258 (JapanesePoliteToggle), :1390-1396 (usage); network VoiceProfileApi.kt:117-120 (voiceGender/speechFormality multipart parts); data/VoiceProfileCreationDraft.kt:9-12`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmTalkAPI.swift:109-131 (voiceCloneMultipartFields — no voiceGender/speechFormality); apps/ios-native/AlarmTalk/Views/Voices/VoiceCloneUploadFlow.swift (no gender/polite controls); apps/ios-native/AlarmTalk/AlarmTalkAPIModels.swift:373-394 (VoiceProfileUpdateRequest lacks both fields)`
- **차이**: Android's voice-creation UI lets the user pick a voice gender chip (male/female/neutral) and toggle Japanese 정중체 (speech_formality polite/auto), sending voiceGender + speechFormality multipart fields on POST /voice/clone. The backend persists them (voice-profile.ts:696-706, 795-806) and reads vp.voice_gender / vp.speech_formality during TTS generation to adjust Japanese first-person pronouns and formality (tts.ts:782-783). iOS sends neither field anywhere (no UI control, not in the clone multipart, not in the update request), so every iOS-created voice is stored as null→default gender/formality and Japanese/formality tuning never reflects user choice.
- **수정안**: Add a gender selector (male/female/neutral) and a Japanese-polite toggle to VoiceCloneUploadFlow, thread the chosen values through cloneVoice / cloneWithNoiseRemoval / cloneAudioForProfile, and add `voiceGender` + `speechFormality` to AlarmTalkAPI.voiceCloneMultipartFields (sending 'neutral'/'auto' defaults like Android's draft path). Optionally add voice_gender/speech_formality to VoiceProfileUpdateRequest to mirror VoiceProfileApi.kt:59-62.

### 🟡 Recording does not auto-stop at 2 minutes on iOS
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/data/AlarmVoiceRecorder.kt:30 (setMaxDuration); apps/android-native/.../ui/voices/VoiceProfileManagementPanel.kt:599-601 (loop auto-stops at MAX_DURATION_MILLIS)`
- **iOS**: `apps/ios-native/AlarmTalk/VoiceRecorder.swift:24-57 (no max-duration enforcement); apps/ios-native/AlarmTalk/Views/Voices/VoiceCloneUploadFlow.swift:249-282 (record button + levelTimer only animate, no elapsed-based stop)`
- **차이**: Android caps recording at VoiceProfileAudioLimits.MAX_DURATION_MILLIS (120s) via MediaRecorder.setMaxDuration and an explicit UI loop that calls stopRecording() once elapsed >= 120s. iOS VoiceRecorder has no max-duration and the clone flow's timer only drives the waveform animation, so recording continues indefinitely until the user manually taps stop; an over-2-minute take is then rejected at upload instead of being prevented. The duration progress bar caps at 1.0 but never stops the recorder.
- **수정안**: In VoiceRecorder (or the clone-flow timer) track elapsed against VoiceProfileLimits.maxDurationMs and auto-invoke stop() when reached, mirroring Android's 120s hard cap.

### 🟡 File-crop selector is a fixed 120s window on iOS vs adjustable 60–120s range on Android
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/components/VoiceInputControls.kt:259-339 (AudioCropRangeSelector — dual-thumb RangeSlider, selectable length clamped between minDurationMillis=60s and maxDurationMillis=120s)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Voices/VoiceCloneUploadFlow.swift:362-378 (single Slider sets cropStartMs only; cropEndMs = min(durationMs, cropStartMs + maxDurationMs))`
- **차이**: For source files longer than 120s, Android shows a two-thumb range slider letting the user choose any sub-segment whose length is between 60s and 120s (e.g. a clean 75s span). iOS shows only a single start slider and locks the end to start+120s, so the selected window is always exactly 120s — the user cannot trim down to a shorter clean segment or independently move the end. Behavior/affordance diverge.
- **수정안**: Replace the single-start Slider in fileCropCard with a dual-thumb range control that enforces 60s ≤ (cropEndMs - cropStartMs) ≤ 120s, mirroring Android's AudioCropRangeSelector clamping logic.

### ⚪ Dynamic-voice refresh falls back to 'preset' on iOS vs 'wake_weather' on Android
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/data/AlarmRepository.kt:556 and :796 (randomContext = alarm.voiceRandomContext ?: DefaultDynamicVoiceContext where DefaultDynamicVoiceContext = "wake_weather")`
- **iOS**: `apps/ios-native/AlarmTalk/DynamicVoiceRefreshService.swift:63 (randomContext: alarm.voiceRandomContext ?? RandomPromptContext.defaultContext.rawValue, where defaultContext = .preset — AlarmEnums.swift:199)`
- **차이**: When a repeating dynamic-voice alarm has no stored voiceRandomContext, the background refresh fallback differs: Android sends 'wake_weather' (a dedicated DefaultDynamicVoiceContext constant), while iOS sends the general default 'preset'. This changes the regenerated nightly TTS content (weather-based wake message vs generic preset) for context-less dynamic alarms.
- **수정안**: Introduce a dedicated dynamic-refresh fallback constant equal to "wake_weather" and use it in DynamicVoiceRefreshService.swift:63 instead of RandomPromptContext.defaultContext.rawValue, matching Android's DefaultDynamicVoiceContext.

### ⚪ Max-duration tolerance (5s) not honored on iOS
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/data/AlarmAudioStore.kt:33 (MAX_DURATION_TOLERANCE_MILLIS = 5_000); ui/voices/VoiceProfileManagementPanel.kt:118-120 (error only when durationMillis > MAX + tolerance)`
- **iOS**: `apps/ios-native/AlarmTalk/VoiceStudioViewModel.swift:338,434 and Views/Voices/VoiceCloneUploadFlow.swift:86 (strict durationMs <= VoiceProfileLimits.maxDurationMs, no tolerance)`
- **차이**: Android accepts clone/upload audio up to 125s (120s max + 5s metadata tolerance) before showing the 'under two minutes' error, absorbing duration-measurement rounding. iOS validates strictly against 120000ms, so a 120.1–125s file/recording that Android would accept is rejected on iOS. Minor edge-case divergence in the accepted-length boundary.
- **수정안**: Add a maxDurationToleranceMs (5_000) constant to VoiceProfileLimits and apply it in the upper-bound checks (canUploadRecording, uploadRecordingForClone, cloneAudioForProfile, VoiceCloneUploadFlow.isInValidRange) to match Android's tolerance.

### ⚪ TTS local cache key normalizes category before hashing; Android does not
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/data/AlarmAudioStore.kt:799-807 (ttsCacheKey hashes raw category, no remap)`
- **iOS**: `apps/ios-native/AlarmTalk/AudioCacheStore.swift:243-244 (applies normalizedTtsCategory(category) before hashing)`
- **차이**: iOS ttsCacheKey runs the category through normalizedTtsCategory (legacy-key remap) before building the SHA-256 fallback key, whereas Android hashes the category string verbatim. For legacy category values the two platforms compute different local cache keys for identical inputs. Impact is limited because the server-provided cache_key takes priority when present (both platforms short-circuit on serverCacheKey), so this only affects the offline/no-server-key fallback dedup.
- **수정안**: Hash the raw category in AudioCacheStore.ttsCacheKey (drop the normalizedTtsCategory call) so the local fallback key matches Android's tts-v2|profile|text|category|language scheme exactly.

---

## [home-list-ui] Home & alarm-list UI — `major-gaps`

iOS reproduces the Android Korean copy, tab set/order, next-alarm computation, and list ordering faithfully, but diverges substantially in structure and styling. The Character/Growth feature that Android fully removed is still shipped on iOS (a home CharacterMiniCard plus a 캐릭터 menu entry) — a stale-feature defect. The alarm list is rendered as one grouped card of small chips instead of Android's separate per-alarm cards, the hero waveform is static instead of animated, several token values (corner radius, accent colors, selected-tab color) are hardcoded and wrong, and the home/alarm components use light-only static colors so dark mode is broken. There are also behavioral deltas (extra copy action, always-visible overflow button, added delete-confirm alert, missing Messages lock indicator). Overall: major gaps.

### 🔴 iOS still ships the removed Character/Growth card on Home ✅(high, 실제 high)
- **분류**: stale-feature
- **Android**: `apps/android-native/.../ui/alarms/AlarmListScreen.kt:190-224 (Home tab = HomeHeader + NextAlarmHeroCard + QuickStartGrid only; no character card anywhere in ui/home)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Home/HomeView.swift:45-47; apps/ios-native/AlarmTalk/Views/Home/CharacterMiniCard.swift`
- **차이**: Android removed the Character/Growth feature (FE+BE, character_events dropped). iOS HomeView still renders CharacterMiniCard (LV/streak/XP progress reading socialFeatures.character) as the 4th block under the quick-start grid. This is a removed feature still present on iOS.
- **수정안**: Delete the CharacterMiniCard() block from HomeView.body and remove CharacterMiniCard.swift (and its SocialFeatureViewModel.character dependency) so Home shows only header + hero + quick-start, matching Android.

### 🟠 Profile/overflow menu still exposes a stale 캐릭터 (Growth) entry ✅(high)
- **분류**: stale-feature
- **Android**: `apps/android-native/.../ui/home/HomeComponents.kt:80-163 (ProfileMenu: invite code, pass, shared pass, divider, settings — no character item)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Root/MainTabsView.swift:68-72; apps/ios-native/AlarmTalk/Views/Auxiliary/AuxiliaryScreen.swift:10,19`
- **차이**: The iOS toolbar profile menu includes a '캐릭터' item that opens AuxiliaryScreen.growth. Android's equivalent ProfileMenu has no character/growth entry because the feature was removed. The .growth auxiliary route and GrowthPanel are stale.
- **수정안**: Remove the 캐릭터 Button from the MainTabsView toolbar menu and drop the .growth case from AuxiliaryScreen (and its sheet host wiring), leaving invite-code / 이용권 / 공유 이용권 / 설정 to match Android.

### 🟠 Home & alarm-list views use light-only static colors, breaking dark mode ✅(high)
- **분류**: styling-diff
- **Android**: `apps/android-native/.../ui/theme/AlarmTalkTheme.kt (full darkColorScheme); ui/app/AlarmTalkBottomBar.kt:116-126 even branches on isDarkScheme`
- **iOS**: `apps/ios-native/AlarmTalk/Theme.swift:14-36; HomeView.swift:144-147; NextAlarmHeroCard.swift:17-41; QuickStartGrid.swift:18-19,62-87; AlarmRow.swift:81-84,119,123,40`
- **차이**: These views consume the static AlarmTalkTheme.* enum (Theme.swift comment: 'no dark variant — renders the light palette in dark mode too') for text/foreground/surface, while sectionSurface() and MainTabsView use the dark-adaptive @Environment palette. In dark mode the hero/row text is near-black (#181922) on a dark surface (#14161E) = unreadable, and QuickActionCards stay white. Android renders these screens correctly in dark mode.
- **수정안**: Replace AlarmTalkTheme.text/textSecondary/primary/primaryDark/surface/surfaceVariant/error usages in HomeView, NextAlarmHeroCard, QuickStartGrid, AlarmRow and EmptyStatePlaceholder with @Environment(\.voiceAlarmTheme).palette.* tokens so they adapt to the active color scheme like the rest of the app.

### 🟠 Alarm list rendered as one grouped card instead of separate per-alarm cards ✅(high)
- **분류**: ui-diff
- **Android**: `apps/android-native/.../ui/alarms/AlarmListScreen.kt:181-188,271-280 (LazyColumn, spacedBy 16dp, each item a standalone AlarmRow); ui/components/ControlsAndPermissions.kt:263-297 (Card WakerCardShape=22, border, surface, padding 18)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Alarms/AlarmsListView.swift:68-103 (ForEach wrapped in one .sectionSurface(), spacing 12); apps/ios-native/AlarmTalk/Views/Alarms/AlarmRow.swift:40-41,59,126 (per-row surfaceVariant bg, cornerRadius 8, padding 12)`
- **차이**: Android shows each alarm as its own 22-radius surface Card with a 1px border, 18dp padding, separated by 16dp gaps. iOS groups all rows inside a single 8-radius sectionSurface card, with each row a small 8-radius surfaceVariant chip (padding 12, 12dp spacing). The grouping, corner radius (22 vs 8), row background (surface+border vs surfaceVariant), padding (18 vs 12) and spacing (16 vs 12) all differ.
- **수정안**: Drop the outer .sectionSurface() in localAlarmSection; render each AlarmRow as a standalone card with surface background + outlineVariant 1px border, WakerCardShape-equivalent 22 corner radius, 18 padding, and 16pt inter-row spacing.

### 🟡 AlarmRow internal styling differs (time font size, label truncation, warning surface)
- **분류**: styling-diff
- **Android**: `apps/android-native/.../ui/components/ControlsAndPermissions.kt:308-310 (time headlineLarge ~32sp), 318-330 (label bodyMedium SemiBold, maxLines 1 + Ellipsis), 338-362 (warning: WakerTileShape=12, errorContainer @0.72, Icons.Outlined.ErrorOutline)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Alarms/AlarmRow.swift:79-81 (time .title2.regular ~22pt), 82-84 (label no lineLimit), 112-124 (warning: cornerRadius 8, error.opacity(0.08), exclamationmark.triangle)`
- **차이**: The time is markedly smaller on iOS (title2 ~22 vs headlineLarge ~32). The label has no line limit on iOS so long names wrap and break the row, whereas Android forces single-line ellipsis. The failure/sync warning chip uses error@8% with a triangle icon and 8-radius vs Android's errorContainer@72% with ErrorOutline and 12-radius (WakerTileShape).
- **수정안**: Increase the time font to ~32 (headlineLarge equivalent), add .lineLimit(1) to the label, and style the warning surface with errorContainer (≈72% alpha) background, onErrorContainer text, a 12-radius tile, and an ErrorOutline-style icon.

### 🟡 Home voice waveform is static and has 32 bars instead of animated 40 bars
- **분류**: ui-diff
- **Android**: `apps/android-native/.../ui/home/HomeCards.kt:143-189 (HomeVoiceWaveform: rememberInfiniteTransition phase animation, 40 levels, Arrangement.SpaceBetween full width, animated per-bar alpha 0.58–0.96 active / 0.24–0.52 idle)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Home/NextAlarmHeroCard.swift:50-65 (static 32-bar array, fixed spacing 4, constant opacity 0.82 active / 0.36 idle, comment '정적인 32-bar 파형')`
- **차이**: Android animates the hero waveform (infinite phase sweep modulating both bar height and alpha) across 40 bars distributed SpaceBetween over the full width. iOS draws a static 32-bar waveform with fixed spacing and constant opacity — different bar count, no animation, different layout and alpha.
- **수정안**: Add a TimelineView/animation driving a phase value, use the full 40-level array, lay bars out with Spacer-based SpaceBetween across full width, and modulate height+opacity per Android's wave formula (0.58+0.38*wave active, 0.24+0.28*wave idle).

### 🟡 Next-alarm hero card corner radius, padding, border and time typeface differ
- **분류**: styling-diff
- **Android**: `apps/android-native/.../ui/home/HomeCards.kt:56-95 (WakerHeroShape=24, padding 20, border outlineVariant; time displayLarge in default app font)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Home/NextAlarmHeroCard.swift:13-45; apps/ios-native/AlarmTalk/Views/Common/SectionCard.swift:30-40 (sectionSurface: cornerRadius 8, padding 16, border surfaceVariant); time .system(size:56, design:.rounded)`
- **차이**: The hero card uses the generic sectionSurface (8 radius, 16 padding, surfaceVariant border) instead of Android's 24-radius hero shape, 20 padding and outlineVariant border. The big time also uses SF Rounded numerals on iOS whereas Android uses its standard typeface (displayLarge).
- **수정안**: Give the hero card a dedicated 24-radius surface with 20 padding and an outlineVariant border, and render the time with the standard (non-rounded) font weight bold to match displayLarge.

### 🟡 Quick-start action card accent colors are hardcoded literals, not theme containers
- **분류**: styling-diff
- **Android**: `apps/android-native/.../ui/home/HomeCards.kt:213-243 (voice=secondaryContainer #E3F4FA, new alarm=primaryContainer #D6E9FF, family=secondaryContainer; icon fg onSecondaryContainer/onPrimaryContainer)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Home/QuickStartGrid.swift:24,31,40,65 (voice=Color(0.86,0.91,0.96)≈#DBE8F5, alarm=Color(0.98,0.89,0.58)≈#FAE394 yellow, family=Color(0.88,0.95,0.91)≈#E0F2E8 green; icon fg AlarmTalkTheme.text)`
- **차이**: The icon-circle backgrounds are three hardcoded pastel literals. The 'new alarm' card is yellow on iOS but light-blue primaryContainer on Android; the family card is green on iOS but the same blue secondaryContainer as the voice card on Android. None adapt to dark mode, and the icon foreground uses static text color instead of onContainer colors.
- **수정안**: Use palette.secondaryContainer for voice & family and palette.primaryContainer for new alarm, with onSecondaryContainer/onPrimaryContainer icon tints, dropping the Color(red:…) literals.

### 🟡 Bottom-nav selected tab uses surfaceVariant/onSurface instead of primaryContainer/onPrimaryContainer
- **분류**: styling-diff
- **Android**: `apps/android-native/.../ui/app/AlarmTalkBottomBar.kt:116-126,140-146,164-170 (selected bg=primaryContainer light / surfaceVariant dark; selected content=onPrimaryContainer light / primary dark)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Root/BottomNavBar.swift:42-47 (selected bg=surfaceVariant always; selected content=onSurface)`
- **차이**: Android highlights the active tab with a primaryContainer (blue) pill and onPrimaryContainer content in light mode (and a dark-mode-specific branch). iOS always uses a grey surfaceVariant pill with onSurface content, so in light mode the selected tab is grey instead of blue.
- **수정안**: Match Android: selected background palette.primaryContainer with onPrimaryContainer content in light scheme (and surfaceVariant/primary in dark), keeping the 14-radius pill.

### 🟡 Messages tab has no lock indicator and shows its badge while locked
- **분류**: missing-feature
- **Android**: `apps/android-native/.../ui/app/AlarmTalkBottomBar.kt:89-98,152,173-189; ui/app/AlarmTalkApp.kt:464-465 (messagesLocked = !couple/family access → lock overlay + badge suppressed while locked)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Root/BottomNavBar.swift:8-51; apps/ios-native/AlarmTalk/Views/Root/MainTabsView.swift:243-252`
- **차이**: Android draws a small lock glyph over the Messages tab icon when the user lacks couple/family access and hides that tab's unread badge while locked. iOS BottomNavBar has no locked concept: it never shows a lock and always renders the unread-note badge regardless of access (gating happens only via planGate on tap).
- **수정안**: Plumb a messagesLocked flag into BottomNavBar (couple/family access check), overlay a lock icon on the Messages tab when locked, and return 0/hide the badge for that tab while locked.

### 🟡 AlarmRow adds a delete-confirmation alert that Android does not have
- **분류**: logic-diff
- **Android**: `apps/android-native/.../ui/components/ControlsAndPermissions.kt:371-384 (long-press menu Delete → onDelete immediately), 400-402 (DeleteRevealButton onClick = onDelete immediately)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Alarms/AlarmRow.swift:63-71,104,133-135 (both swipe and menu route through confirmingDelete .alert before deleting)`
- **차이**: Android deletes the alarm immediately when the swipe delete button or long-press menu item is tapped — no confirmation dialog. iOS interposes an '알람 삭제' confirmation alert on both the swipe button and overflow menu. The deletion flow (immediate vs confirm) diverges.
- **수정안**: Remove the confirmingDelete alert and call onDelete directly from the swipe button and menu to match Android's immediate-delete behavior (the swipe gesture already serves as the safeguard).

### 🟡 AlarmRow shows a persistent overflow (ellipsis) button absent on Android
- **분류**: ui-diff
- **Android**: `apps/android-native/.../ui/components/ControlsAndPermissions.kt:266-278,366-385 (no visible overflow control; delete menu only via combinedClickable onLongClick)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Alarms/AlarmRow.swift:100-109 (always-visible ellipsis.circle Menu next to the toggle)`
- **차이**: Android's row layout is just [time/label | switch]; the delete menu surfaces only on long-press (no visible control). iOS adds an always-visible ellipsis.circle button after the toggle, changing the row layout and adding a discoverable menu Android intentionally hid.
- **수정안**: Remove the visible ellipsis Menu from the row and expose the delete (and any retained) action via a long-press menu like Android, keeping the visible row to [time/label | toggle].

### 🟡 iOS adds an alarm copy/duplicate action that Android's list does not have
- **분류**: stale-feature
- **Android**: `apps/android-native/.../ui/alarms/AlarmListScreen.kt:272-279 (AlarmRow only wired with toggle/edit/delete); ui/components/ControlsAndPermissions.kt:217-386 (no copy path)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Alarms/AlarmRow.swift:101-104; apps/ios-native/AlarmTalk/Views/Alarms/AlarmsListView.swift:92-94,174-196 (copyAlarm → store.copyAlarm, schedules a +10min duplicate)`
- **차이**: iOS's overflow menu offers '복사', duplicating the alarm 10 minutes later via LocalAlarmStore.copyAlarm. Android's alarm list has no duplicate/copy affordance at all. This is an iOS-only feature relative to the Android baseline.
- **수정안**: Remove the 복사 menu action and the copyAlarm wiring from AlarmRow/AlarmsListView to match Android (or, if intended for both, add it to Android first — but per Android-as-baseline it should be removed).

### 🟡 Empty alarm state layout, icon, title size and added subtitle differ
- **분류**: ui-diff
- **Android**: `apps/android-native/.../ui/alarms/AlarmListComponents.kt:71-101 (own WakerPanelShape=18 card, padding 24, center-aligned, Alarm icon 44dp secondary tint, title titleLarge bold, no subtitle, then pill button)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Alarms/AlarmsListView.swift:70-83; apps/ios-native/AlarmTalk/Views/Common/EmptyStatePlaceholder.swift:13-31`
- **차이**: Android's empty card is centered with a large 44dp secondary-tinted alarm icon, a titleLarge bold title and just a Create button. iOS uses the generic EmptyStatePlaceholder: leading-aligned, small title2 icon (primaryDark), subheadline title, an extra subtitle '새 알람을 만들면 기기에 바로 예약돼요.' Android lacks, on a surfaceVariant chip inside the outer grouped card.
- **수정안**: Render a centered empty state with a large (~44) secondary-tinted alarm icon, a titleLarge bold '아직 알람이 없어요.' title, no subtitle, and the create button, in its own 18-radius surface card.

### ⚪ Family quick-action uses a bell icon instead of the people/group icon
- **분류**: ui-diff
- **Android**: `apps/android-native/.../ui/home/HomeCards.kt:236 (Icons.Outlined.People)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Home/QuickStartGrid.swift:39 (systemName: "bell.badge")`
- **차이**: Android's '상대 알람 맞춰주기' card shows a group-of-people glyph; iOS shows a bell-with-badge glyph for the same card.
- **수정안**: Use a people/group SF Symbol (e.g. "person.2") for the family quick-action icon to match Android's People icon.

### ⚪ Alarm-tab permission UI omits notification/full-screen/mic rows Android surfaces
- **분류**: ui-diff
- **Android**: `apps/android-native/.../ui/alarms/AlarmListScreen.kt:260-268; ui/components/ControlsAndPermissions.kt:86-149 (PermissionPanel with Allow-All + 4 rows: exact alarm, notifications, full-screen intent, mic)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Alarms/AlarmPermissionSection.swift:10-46 (single alarm-authorization card + one request/settings button)`
- **차이**: When alarm permissions aren't ready Android shows a 4-row panel (exact alarm, notifications, full-screen intent, microphone) plus an Allow-All button. iOS shows only AlarmKit authorization status with one button. Part of this is genuinely platform-divergent (AlarmKit bundles scheduling auth; no full-screen-intent concept on iOS), but iOS surfaces neither notification nor mic permission state on the alarm tab.
- **수정안**: Where applicable on iOS, surface notification (and mic) authorization status rows alongside the alarm authorization on the alarm tab so the user sees the same permission readiness Android shows; document the full-screen-intent row as N/A on iOS.

### ⚪ Enable toggle does not pre-request alarm permission before scheduling
- **분류**: error-handling
- **Android**: `apps/android-native/.../ui/app/AlarmTalkApp.kt:631-637 (onToggleEnabled: if enabling && !alarmReady → requestFirstMissingAlarmPermission() instead of toggling)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Alarms/AlarmsListView.swift:126-156 (setAlarm: optimistically setEnabled then schedule; on failure markFailed + actionMessage)`
- **차이**: When a user enables an alarm without alarm permission, Android intercepts and launches the permission request flow rather than toggling. iOS flips the toggle, attempts to schedule, and on failure marks the alarm failed and shows a status message — a different failure path/UX for the missing-permission case.
- **수정안**: On enable, check alarm authorization first and request it (mirroring openCreateAlarm's gate) before scheduling, instead of optimistically toggling and surfacing a generic failure message.

### ⚪ Home profile entry is a plain toolbar glyph vs Android's styled avatar button
- **분류**: styling-diff
- **Android**: `apps/android-native/.../ui/home/HomeComponents.kt:88-109 (44dp secondaryContainer circle, outlineVariant border, 4dp shadow, Person icon) floated top-right on Home (AlarmTalkApp.kt:770-787)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Root/MainTabsView.swift:91-94 (plain person.crop.circle SF Symbol in the nav bar)`
- **차이**: Android presents the profile menu trigger as a prominent filled circular avatar (secondaryContainer fill, border, shadow) overlaid on the screen content. iOS uses an unstyled person.crop.circle symbol in the navigation toolbar. The entry point exists on both, but the visual treatment differs.
- **수정안**: If matching Android closely, render the profile trigger as a filled secondaryContainer circle with border to mirror the avatar styling; otherwise accept as an idiomatic iOS toolbar treatment.

---

## [settings-onboarding] Settings, onboarding, guide & permissions — `major-gaps`

iOS diverges substantially from the Android baseline in this area. Two removed Character/Growth surfaces still ship on iOS (a 3rd onboarding page and the whole GrowthPanel), and the Settings screen is missing two entire Android sections (Terms & Policy links, and the Marketing-consent toggle with its load/write/error states). The first-run guide system only covers 2 of Android's 4 guides (home and voice-register coachmarks are absent) and uses center cards instead of Android's anchored spotlight. Holiday-country selection, settings-row icons, and card styling also deviate. Permission gating differs but is largely legitimate AlarmKit-driven platform idiom and was not flagged.

### 🔴 Onboarding still shows removed 'Character Growth' 3rd page ✅(high, 실제 high)
- **분류**: stale-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/onboarding/OnboardingScreen.kt:47-59`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Auth/OnboardingView.swift:110-116`
- **차이**: Android's onboarding pager defines exactly 2 pages (Voice=Mic, Together=Group) after the Character/Growth feature was removed. iOS's OnboardingPage.all has 3 entries; the 3rd ('알람을 끄며 함께 성장해요' / '하루를 시작할 때마다 캐릭터의 성장 기록이 쌓여요.', sparkles, useTertiary:true) is the removed character-growth page. The file header comment (line 6) even documents '세 번째 = 캐릭터'. This shows users a feature that no longer exists.
- **수정안**: Remove the 3rd OnboardingPage entry (lines 110-115) so iOS shows the same 2 pages as Android; drop the now-unused `useTertiary` branch and update the header comment. The dot indicator/last-page logic already derives from `OnboardingPage.all.count`, so no other change is needed.

### 🔴 GrowthPanel (Character Growth) still shipped and reachable ✅(high, 실제 high)
- **분류**: stale-feature
- **Android**: `n/a (Character/Growth removed from Android FE+BE; character_events table dropped)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Settings/GrowthPanel.swift:7; apps/ios-native/AlarmTalk/Views/Auxiliary/AuxiliarySheetHost.swift:57-58`
- **차이**: iOS still ships the full '캐릭터 성장' panel (stage/level/streak/stats/sync + CharacterEventStore, CharacterSummaryView) and exposes it via AuxiliaryScreen.growth from the profile/aux menu. Android removed this feature entirely. The panel and its menu entry are live stale surfaces. (May overlap with the social/people area audit.)
- **수정안**: Delete GrowthPanel.swift, remove the `.growth` case from AuxiliaryScreen and AuxiliarySheetHost.content, remove the profile-menu entry that opens it, and drop CharacterEventStore/character event queuing wired to alarm dismiss/snooze.

### 🟠 Settings missing '약관 및 정책' (Terms & Policy) section ✅(high, 실제 medium)
- **분류**: missing-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/settings/SettingsScreen.kt:145-159`
- **iOS**: `n/a (missing)`
- **차이**: Android Settings has a 'hs_settings_section_terms' ("약관 및 정책") card with two rows: 이용약관 → https://alarm-talk.com/ko/terms and 개인정보 처리방침 → https://alarm-talk.com/ko/privacy, opened via external browser. iOS SettingsView (sections: 화면 / 랜덤 문구 정보 / 공휴일 / 계정 / 탈퇴) has no Terms or Privacy entry anywhere post-login; those URLs are only reachable from the one-time ConsentView gate at signup.
- **수정안**: Add a `.settingsCard(title: "약관 및 정책")` after the random-phrase section containing two value/action rows that open https://alarm-talk.com/ko/terms and https://alarm-talk.com/ko/privacy (e.g. via openURL), matching Android's order and copy.

### 🟠 Settings missing '마케팅 수신' consent toggle section ✅(high)
- **분류**: missing-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/settings/SettingsScreen.kt:161-190; apps/android-native/app/src/main/java/com/alarmtalk/app/ui/main/MainViewModelAuthActions.kt:630-712`
- **iOS**: `n/a (missing)`
- **차이**: When logged in, Android Settings shows a 'settings_marketing_section' ("마케팅 수신") card that loads current marketing consent via GET /user/consents (consent_type=='marketing'), lets the user toggle it via POST /user/consents (type 'marketing', agreed, policy version), and handles three states: loaded toggle (disabled while write in flight), load-failed retry row, and a disabled '불러오는 중…' placeholder. iOS only collects marketing once at ConsentView signup (onAgree marketingAgreed) and provides no way to view or change it later; iOS Settings has no such section and AlarmTalkAPI has no list-consents GET.
- **수정안**: Add a logged-in-only marketing card to SettingsView. Add a `listConsents` GET /user/consents method to AlarmTalkAPI, load on appear to seed the toggle, and write changes via the existing recordConsents POST with a ConsentItemRequest(type:"marketing"). Replicate the busy/loading/load-failed states from SettingsScreen.kt:164-188.

### 🟡 Home and voice-register first-run coachmarks absent on iOS
- **분류**: missing-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/alarms/AlarmListScreen.kt:159-178,352-373; apps/android-native/app/src/main/java/com/alarmtalk/app/ui/guide/UsageGuideStore.kt:22-26`
- **iOS**: `apps/ios-native/AlarmTalk/UsageGuideStore.swift:8-11`
- **차이**: Android defines 4 guides (alarm_editor_v1, voice_create_v1, home_v1, voice_register_v1) and auto-shows the Home coachmark on first Home-tab visit and the Voice-register coachmark on first Voices-tab visit (700ms delay, once). iOS UsageGuideStore.GuideID only declares alarmEditor and voiceClone, and no home/voice-tab guide is presented anywhere. So two of Android's four first-run guides are missing on iOS.
- **수정안**: Add `home` and `voiceRegister` GuideID cases and present a first-visit guide (sheet or spotlight) on the Home and Voices tabs in iOS, persisting via UsageGuideStore.markSeen, mirroring AlarmListScreen.kt's homeCoachSteps/voiceRegisterCoachSteps content and trigger logic.

### 🟡 Guides use generic center cards instead of anchored spotlight coachmarks
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/guide/CoachMarkOverlay.kt:110-219; apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/AlarmEditorScreen.kt:1396-1404`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Guide/UsageGuideSheet.swift:16-94; apps/ios-native/AlarmTalk/Views/Editor/AlarmEditorSheet.swift:289-291`
- **차이**: Android's alarm-editor (and home/voice) guide is an anchored CoachMarkOverlay: a dimmed scrim with a rounded spotlight hole punched over the actual target control (concentric corner radius, auto-scroll to off-screen targets, primary highlight border) plus a contextual card. iOS replaces this with UsageGuideSheet — a centered card carousel with generic illustrations that does not point at any control. The alarm-editor guide exists on both but the presentation/teaching model differs substantially.
- **수정안**: Implement a spotlight-style coachmark overlay on iOS (register target frames via a PreferenceKey, draw a scrim with a cut-out over the target, position the explanation card above/below the hole) for the alarm-editor and the home/voice guides, matching CoachMarkOverlay behavior. If full parity is out of scope, at minimum align the step copy/targets.

### 🟡 Holiday-country selector: different placement, control and label
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/settings/SettingsScreen.kt:104-118,283-321 (label string 'settings_holiday_country_title'="공휴일 달력")`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Settings/SettingsView.swift:68-86`
- **차이**: Android places holiday selection as the 2nd row inside the '화면(Display)' card — a standard value row (label "공휴일 달력", value = flag+country, chevron) that opens a radio-button AlertDialog. iOS instead creates a separate '공휴일' card containing an inline `.menu` Picker labeled '공휴일 국가' plus an explanatory caption that Android does not show in the list. So the section grouping, the control type (radio dialog vs inline menu), the row pattern, and the label copy all diverge.
- **수정안**: Move holiday selection into the '화면' settingsCard as a SettingsValueButton labeled '공휴일 달력' showing flag+country, opening a radio-list selection sheet/dialog like Android's HolidayCountryPickerDialog. Remove the standalone '공휴일' card, the inline Picker, and the caption.

### ⚪ Settings rows add leading icons not present on Android
- **분류**: styling-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/settings/SettingsScreenComponents.kt:77-110`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Settings/SettingsView.swift:186-215; apps/ios-native/AlarmTalk/Views/Settings/AccountPanel.swift:20-34`
- **차이**: Android's SettingsRow is label (weight 1f) + optional value + trailing chevron, with no leading icon. iOS's SettingsValueButton and the AccountPanel nickname row prepend a leading SF Symbol (theme: currentThemeMode.systemImage; 날씨 지역: cloud.sun; 운세 정보: sparkles; 닉네임: person.text.rectangle) tinted primaryDark. This is an extra visual element Android does not have.
- **수정안**: Remove the leading Image(systemName:) from the settings value rows and the nickname row so the row layout (label + value + chevron) matches Android exactly.

### ⚪ Settings card corner radius and title typography differ from Android tokens
- **분류**: styling-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/settings/SettingsScreenComponents.kt:57-74`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Common/SectionCard.swift:43-64`
- **차이**: Android's SettingsCard wraps content in an OutlinedCard (default shape = MaterialTheme.shapes.medium, mapped to WakerInputShape = 18dp per AlarmTalkTheme.kt) with the outline-colored border and a 'labelLarge' onSurfaceVariant title. iOS's settingsCard uses RoundedRectangle(cornerRadius: 8) with a surfaceVariant 1pt stroke and a '.caption' title. The corner radius (8 vs 18) and title font (caption vs labelLarge) deviate from the Android tokens.
- **수정안**: Raise the settingsCard corner radius to the WakerInputShape equivalent (18) and use the outline color for the stroke; set the section title font to the labelLarge-equivalent token to match SettingsCard.

### ⚪ Onboarding descriptions hardcode line breaks Android deliberately avoids
- **분류**: styling-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/onboarding/OnboardingScreen.kt:48; apps/android-native/app/src/main/res/values/strings.xml:1004,1006`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Auth/OnboardingView.swift:101,107`
- **차이**: Android intentionally stores onboarding descriptions without hardcoded '\n' (comment at OnboardingScreen.kt:48 explains this avoids awkward breaks at large font scales) — e.g. '녹음하거나 만든 목소리로 내 알람을 울릴 수 있어요.'. iOS hardcodes a '\n' in the same descriptions ('녹음하거나 만든 목소리로\n내 알람을 울릴 수 있어요.' / '목소리와 메시지를 주고받고\n서로의 아침을 챙길 수 있어요.'), forcing a fixed break.
- **수정안**: Remove the '\n' from the iOS onboarding description strings and let multilineTextAlignment(.center) wrap naturally, matching Android.

---

## [design-tokens] Design tokens & theming (CSS-level) — `major-gaps`

Color tokens are excellent: iOS AlarmTalkPalette.light/dark are byte-identical 1:1 mirrors of Android's light/darkColorScheme (all 24 light + 24 dark roles verified), and AccentColor.colorset (light 0x175FB0 / dark 0xA6D2FF) matches. Divergences are in shapes, typography, dark-mode wiring, scrim, and elevation. TOKEN DIFF - Colors: MATCH. Shapes: Tile12 to extraSmall12 OK, Chip14 to small14 OK, Input/Button/Panel18 to medium18/vocaButton18 OK, Card22 to vocaCard22 OK, Dialog28 to extraLarge28 OK, Pill999 to vocaChip999 OK, but iOS large=24 != Android M3 large(WakerCardShape)=22, and there is NO dedicated Hero(24)/Panel(18) token. Typography: sizes match M3 defaults, but display/headline/titleLarge weights are bold/semibold on iOS vs Android M3 Regular(400); Pretendard tokens are bypassed by ~319 SwiftUI system-font call sites; LineHeight constants are never applied. Theming: the legacy light-only AlarmTalkTheme enum is used 430x across 40 files, so dark mode renders light palette colors. Scrim: Android WakerScrimColor(0xBD05080E) has no iOS token. Elevation/spacing are iOS approximations not derived from Android.

### 🔴 Legacy light-only AlarmTalkTheme color enum (used 430x) breaks dark mode ✅(high, 실제 high)
- **분류**: styling-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/theme/AlarmTalkTheme.kt:24-49`
- **iOS**: `apps/ios-native/AlarmTalk/Theme.swift:14-36`
- **차이**: Android resolves every color through MaterialTheme.colorScheme, which swaps to AlarmTalkDarkColorScheme in dark mode. iOS exposes a parallel legacy static enum AlarmTalkTheme (Theme.swift) whose members all derive from AlarmTalkPalette.light ONLY (e.g. background=.light.background, text=.light.onBackground=0x181922, surface=.light.surface=0xFFFFFF). This enum is referenced 430 times across 40 view files (e.g. ChipStyle.swift:13,32 PermissionPill/ScreenHeader text; NextAlarmHeroCard.swift:18,21,41). The file's own comment admits 'this enum has no dark variant, so these sites render the light palette values in dark mode too.' Dark mode is a user-selectable setting (AlarmTalkThemeMode.dark), so in dark mode near-black light-palette text (0x181922) lands on dark adaptive surfaces (0x14161E) and is unreadable, while Android renders correct dark-scheme colors.
- **수정안**: Delete the light-only AlarmTalkTheme enum and migrate all 430 call sites to read the @Environment voiceAlarmTheme palette (which already resolves light/dark via AlarmTalkThemeProvider). As an interim, make AlarmTalkTheme members colorScheme-aware so they return the dark palette under .dark.

### 🟠 Typography uses SwiftUI system (San Francisco) fonts instead of Pretendard tokens ✅(high)
- **분류**: styling-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/theme/AlarmTalkTypography.kt:9-34`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Common/ChipStyle.swift:31`
- **차이**: Android sets AlarmTalkFontFamily (Pretendard regular/medium/semibold/bold) on every M3 type style, so ALL app text renders in Pretendard. iOS defines a matching Pretendard scale (AlarmTalkTypography.swift) but most screens bypass it: ~319 system-font call sites across 48 view files (e.g. ScreenHeader .font(.largeTitle.weight(.bold)) ChipStyle.swift:31, NextAlarmHeroCard.swift:17 .subheadline and :20 .system(size:56,...,design:.rounded), UsageGuideSheet.swift:32/54/57) vs only ~115 token usages across 18 files. Result: a large fraction of iOS text renders in San Francisco (and even .rounded) rather than Pretendard, diverging from Android's font family.
- **수정안**: Replace SwiftUI system-font modifiers with theme.typography.* (Pretendard) tokens at all call sites, mapping each SF role to its M3 token (e.g. largeTitle to headlineSmall/Medium, subheadline to bodyMedium/labelLarge, caption to labelMedium). Remove design:.rounded so the hero clock uses Pretendard like Android.

### 🟠 Display/headline/titleLarge font weights heavier than Android M3 defaults ❌기각(high)
- **분류**: styling-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/theme/AlarmTalkTypography.kt:16-33`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmTalkTypography.swift:67-78`
- **차이**: Android's AlarmTalkTypography only overrides fontFamily on Compose's Typography() defaults, keeping the M3 default weights: display*, headline*, titleLarge, body* = Regular (W400). iOS hard-codes heavier weights: displayLarge/Medium=.bold (W700), displaySmall/headlineLarge/Medium/Small/titleLarge=.semibold (W600). The iOS file's comment claims it matches 'Compose M3 Typography() defaults', but those styles are Regular on Android. This makes iOS headings 200-300 weight units heavier than Android (titleMedium/Small, body*, label* weights do match).
- **수정안**: Set displayLarge/Medium/Small and headlineLarge/Medium/Small and titleLarge to .pretendard(.regular, ...) to match the M3 defaults Android inherits. Keep titleMedium/Small and label* at .medium and body* at .regular (already correct).

### 🟠 Primary content/hero card surfaces use raw cornerRadius 8 and wrong border token ✅(high)
- **분류**: styling-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/home/HomeCards.kt:58-60`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Common/SectionCard.swift:35-38`
- **차이**: iOS sectionSurface()/settingsCard() (the main content surface, used in 16 files incl. NextAlarmHeroCard.swift:44) clip with RoundedRectangle(cornerRadius: 8) and stroke with palette.surfaceVariant. Android's equivalent surfaces use token radii and outlineVariant borders: the home hero card uses WakerHeroShape=24 + border outlineVariant (HomeCards.kt:58-60), EmptyAlarmCard uses WakerPanelShape=18, other home cards WakerCardShape=22 (HomeComponents.kt:114). 8dp is below the entire token scale (smallest is Tile=12) and surfaceVariant is the wrong border role (Android uses outlineVariant). iOS cards therefore look noticeably squarer and use a different border color than Android.
- **수정안**: Route sectionSurface()/settingsCard() through theme.shapes (e.g. panel=18 / card=22) instead of literal 8, and stroke with palette.outlineVariant not surfaceVariant. Give the home hero card its own 24dp (Hero) surface so NextAlarmHeroCard matches WakerHeroShape; add a dedicated Hero token (see shapes-token finding).

### 🟡 Shape token: iOS large=24 != Android M3 large=22, and no dedicated Hero(24)/Panel(18) token
- **분류**: styling-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/theme/AlarmTalkTheme.kt:109-115`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmTalkShapes.swift:21-32`
- **차이**: Android maps M3 Shapes.large = WakerCardShape = 22.dp (AlarmTalkTheme.kt:113) and keeps WakerHeroShape=24 / WakerPanelShape=18 as distinct named tokens (WakerDesign.kt:27-29). iOS AlarmTalkShapes.default sets large=24 (which equals Hero, not Card) and provides no Hero or Panel token - only generic extraSmall/small/medium/large/extraLarge plus vocaCard(22)/vocaButton(18)/vocaChip(999). So the iOS large slot is 2dp larger than Android's M3 large, and there is no canonical token for Hero(24) or Panel(18) for call sites to consume.
- **수정안**: Set iOS shapes.large = 22 to match Android M3 large (WakerCardShape). Add explicit tokens vocaHero=24 and vocaPanel=18 (and optionally vocaTile=12/vocaChipSmall=14) so call sites reference named radii identical to Android's Waker*Shape set instead of generic slots.

### 🟡 Typography line-height (leading) tokens are defined but never applied
- **분류**: styling-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/theme/AlarmTalkTypography.kt:16-33`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmTalkTypography.swift:91-107`
- **차이**: Android's Compose Typography applies the M3 lineHeight for each style automatically (e.g. bodyLarge 24sp, titleLarge 28sp). On iOS the matching values exist only as the AlarmTalkTypography.LineHeight enum constants and SwiftUI's Font(custom:size:) does not encode leading; no call site applies them via lineSpacing. Multi-line text therefore renders with the platform default (tighter) leading rather than Android's M3 line heights, so paragraph/heading vertical rhythm differs.
- **수정안**: Apply the LineHeight tokens at text call sites (e.g. a Text modifier computing lineSpacing(lineHeight - fontSize) or a custom layout), or wrap each typography token in a helper that pairs font size with its M3 leading, so multi-line text matches Android line heights.

### 🟡 Missing scrim/overlay token (WakerScrimColor 0xBD05080E)
- **분류**: missing-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/components/WakerDesign.kt:34`
- **iOS**: `n/a (missing)`
- **차이**: Android defines WakerScrimColor = Color(0xBD05080E) (ARGB: ~74% alpha over rgb 05,08,0E) as the fixed, theme-independent dim used by coach-mark and usage-guide overlays (UsageGuideOverlay.kt:68, CoachMarkOverlay.kt:188). iOS has no equivalent scrim token anywhere (grep for scrim/0xBD05080E/05080E returns none); the usage guide was reimplemented as a native sheet (UsageGuideSheet.swift) relying on the system's default presentation dimming, whose color/opacity differ from 0xBD05080E.
- **수정안**: Add a WakerScrimColor equivalent (e.g. Color(.sRGB, red:5/255, green:8/255, blue:14/255, opacity:0.74)) to the iOS token set and use it for any custom overlay/coachmark dim so the scrim opacity/hue matches Android.

### ⚪ Elevation tokens are iOS-invented shadows that don't replicate Android dialog/toast elevation
- **분류**: styling-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/voices/VoiceProfileManagementComponents.kt:166`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmTalkElevation.swift:21-31`
- **차이**: Android content cards are flat (CardDefaults.cardElevation(defaultElevation = 0.dp), e.g. AlarmListComponents.kt:76, HomeCards.kt:61), while floating panels/dialogs use shadowElevation = 18.dp (VoiceProfileManagementComponents.kt:166, SocialPanels.kt:538, LoginPermissionGate.kt:77) and the toast/snackbar uses .shadow(12.dp) (AlarmTalkAppHelpers.kt:189). iOS AlarmTalkElevation defines sm(r4,y1)/md(r12,y4)/lg(r24,y8) at black 0.08, but its only consumer is the unused vocaCardSurface (View+AlarmTalkTheme.swift:60); the real surfaces (sectionSurface) apply no shadow, so iOS dialogs/toasts don't carry the Android 18dp/12dp drop shadow.
- **수정안**: Map iOS elevation steps to Android's actual values (content card = none, dialog/floating panel ~= shadowElevation 18dp, toast ~= 12dp) and apply them to the dialog/sheet and toast surfaces so floating elements cast the same shadow depth as Android, keeping content cards flat.

### ⚪ Spacing scale is an iOS-only abstraction with no Android source-of-truth
- **분류**: other
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/components/WakerDesign.kt:13-34`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmTalkSpacing.swift:21-31`
- **차이**: Android has no centralized spacing token; padding/gap values are inline .dp literals at call sites (e.g. hero card padding 20.dp HomeCards.kt:66, EmptyAlarmCard padding 24.dp). iOS introduces a fixed 4/8/12/16/20/24/32/40 scale (AlarmTalkSpacing) and applies it generically. The values are reasonable but are not derived from Android, so screen-by-screen paddings can drift from the exact Android .dp values (which must be matched per the 1:1 directive).
- **수정안**: Treat Android's per-call-site .dp values as the source of truth and audit each screen's padding/spacing against them; keep the spacing scale only where it coincides with Android's literals, otherwise match the exact Android value per component.

---

## [localization] Localization & user-facing copy — `major-gaps`

Android is fully localized into three locales (Korean default + English + Japanese), each strings.xml carrying 1118 string entries (1121 distinct keys) with genuine translations (e.g. "월 3,900원" / "$3.90/mo" / "月額390円"). iOS has NO localization infrastructure whatsoever: zero .strings/.xcstrings/.lproj files, no NSLocalizedString/LocalizedStringKey/String(localized:) usages, and no knownRegions/CFBundleLocalizations in project.yml or Info.plist. Every user-facing string is hardcoded Korean inline in Swift (~1295 Korean string literals across 112 files), so English- and Japanese-locale users get an entirely Korean UI — including permission prompts and the home-screen app name. On top of the missing en/ja, several Korean strings were independently re-authored on iOS and diverge in wording from Android's canonical Korean copy.

### 🔴 iOS ships no localization — Korean-only, hardcoded; English & Japanese locales entirely missing ✅(high, 실제 high)
- **분류**: missing-feature
- **Android**: `apps/android-native/app/src/main/res/values/strings.xml (1118 strings), values-en/strings.xml (1118), values-ja/strings.xml (1118)`
- **iOS**: `apps/ios-native/project.yml:1-93 (no knownRegions/localizations); apps/ios-native/AlarmTalk/* (~1295 hardcoded Korean string literals, e.g. AlarmEnums/AlarmKitViewModel/ConsentView)`
- **차이**: Android provides three fully-translated locales (ko default, en, ja) selected automatically by device language via resource qualifiers; en/ja are real translations, not Korean copies (verified billing_plan_personal_price ko "월 3,900원" / en "$3.90/mo" / ja "月額390円"; auth_consent_age14 ko/en/ja distinct). iOS has zero localization: no Localizable.strings, no .xcstrings catalog, no *.lproj directory, no NSLocalizedString/LocalizedStringKey/String(localized:) calls anywhere, and project.yml declares no knownRegions/development localizations. All UI copy is hardcoded Korean string literals inline in SwiftUI (Text("..."), enum display labels, status messages). Result: an English or Japanese device shows a 100% Korean UI, while the equivalent Android device shows English/Japanese. This is the dominant systemic parity defect for this area.
- **수정안**: Introduce a String Catalog (Localizable.xcstrings) plus an InfoPlist.xcstrings with ko/en/ja, register the three locales in project.yml (knownRegions/CFBundleLocalizations) and CFBundleDevelopmentRegion=ko, then replace every hardcoded Korean literal with String(localized:)/LocalizedStringKey keyed to the SAME key names Android uses in strings.xml, and port Android's en/ja translations (1118 keys) verbatim so device-language selection matches Android 1:1.

### 🟠 Permission usage descriptions hardcoded Korean in Info.plist — no en/ja, unlike Android's localized rationale strings ✅(high, 실제 low)
- **분류**: missing-feature
- **Android**: `apps/android-native/app/src/main/res/values/strings.xml common_permission_gate_exact_alarm_body/_mic_body/_notifications_body/_full_screen_body (+ values-en, values-ja equivalents)`
- **iOS**: `apps/ios-native/AlarmTalk/Info.plist:26 (NSAlarmKitUsageDescription), :28 (NSMicrophoneUsageDescription), :30 (NSLocationWhenInUseUsageDescription)`
- **차이**: Android's permission rationale copy is localized across all three locales (common_permission_gate_* keys present in values/, values-en/, values-ja/). iOS bakes the system permission prompt strings directly into Info.plist as Korean-only literals with no InfoPlist.strings/.xcstrings override, so the OS-level alarm/microphone/location permission dialogs appear in Korean for every user regardless of device language.
- **수정안**: Add an InfoPlist.xcstrings (or per-locale InfoPlist.strings) with ko/en/ja translations for NSAlarmKitUsageDescription, NSMicrophoneUsageDescription and NSLocationWhenInUseUsageDescription, port the corresponding Android en/ja wording, and register the locales in the target so system prompts follow the device language like Android.

### 🟡 Home-screen app name is Korean "알람톡" on iOS vs "AlarmTalk" on Android (all locales)
- **분류**: styling-diff
- **Android**: `apps/android-native/app/src/main/res/values/strings.xml app_name="AlarmTalk" (identical in values-en and values-ja)`
- **iOS**: `apps/ios-native/AlarmTalk/Info.plist:8 (CFBundleDisplayName="알람톡")`
- **차이**: Android's launcher label (app_name) is the Latin brand "AlarmTalk" in all three locales, including Korean. iOS hardcodes CFBundleDisplayName to the Korean "알람톡", so the iOS home-screen/app-switcher name diverges from Android's branding even for Korean users, and has no en/ja variant.
- **수정안**: Either set CFBundleDisplayName to "AlarmTalk" to match Android's launcher label, or localize it via InfoPlist.xcstrings; align with whatever Android app_name resolves to per locale (currently "AlarmTalk" everywhere).

### 🟡 iOS Korean copy re-authored independently and diverges from Android's canonical Korean strings
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/res/values/strings.xml:17 auth_consent_subtitle="아래 항목만 확인하면 돼요. 잠깐이면 끝나요."`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Auth/ConsentView.swift:41 Text("원활한 서비스 제공을 위해 아래 약관에 대한 동의가 필요해요.")`
- **차이**: Because iOS strings are hand-written inline rather than sourced from a shared key set, even the Korean wording drifts from Android. Example: the consent screen subtitle differs (Android "아래 항목만 확인하면 돼요. 잠깐이면 끝나요." vs iOS "원활한 서비스 제공을 위해 아래 약관에 대한 동의가 필요해요."). The permission-gate body copy similarly diverges (iOS LoginPermissionGateView merges exact-alarm/full-screen/notification rationale into one "잠금 화면에서도 정확한 시간에 알람을 울리려면 알람 권한이 필요해요." vs Android's separate common_permission_gate_exact_alarm_body/_full_screen_body/_notifications_body). These are user-visible copy mismatches independent of the missing-locale issue.
- **수정안**: When externalizing iOS strings, copy Android's exact Korean values for each shared key (auth_consent_subtitle, common_permission_gate_* etc.) rather than the current iOS-authored variants, so Korean wording matches Android verbatim; audit the consent, permission, billing, and error flows for the same drift while migrating.

---

## [ringing-firing] Alarm firing, ringing & notifications — `major-gaps`

The core firing/snooze/dismiss contract is largely matched: both compute fireAtMillis identically, snooze re-arms at now + snoozeMinutes*60s, dismiss advances repeating alarms to the next occurrence, the VoiceVolumeRamp curve (6s/12-step, 0.15 start ratio, 0.10 floor) and 900ms voice-repeat gap are ported verbatim, and the holiday-off one-shot re-arm logic mirrors Android's reschedule path. However there are real, user-observable divergences. The most serious is a STALE feature: every alarm dismiss/snooze still emits Character/Growth XP events to backend routes (characters/xp, characters/me) that no longer exist after the character feature was removed. Several other gaps stem from AlarmKit owning the system tone — per-alarm volume/mute is ignored, long (>30s) voice clips are never heard when the phone is locked, and the user-selected vibration pattern has no effect. Overall: real behavioral and contract gaps beyond unavoidable platform mechanics.

### 🟠 iOS still emits Character/Growth XP events on every alarm dismiss and snooze (removed from Android + backend) ✅(high, 실제 medium)
- **분류**: stale-feature
- **Android**: `n/a (character feature removed FE+BE; AlarmRepository.dismiss/snooze at apps/android-native/app/src/main/java/com/alarmtalk/app/data/AlarmRepository.kt:400,443 emit no events)`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmAppContext.swift:125-136 (alarm_completed) and :186-198 (alarm_snoozed); triggered from AlarmKitViewModel.swift:184 and AlarmIntents.swift:133,140; flushed to backend via CharacterEventStore.swift:203 -> AlarmTalkAPI.swift:519-526 POST characters/xp`
- **차이**: When an alarm is stopped or snoozed, AlarmAppContext.handleAlarmStopped/handleAlarmSnoozed queue CharacterEventKind.alarmCompleted / .alarmSnoozed into CharacterEventStore, which on flush POSTs to characters/xp (and the feature also reads characters/me). The Character/Growth feature was fully removed from Android and the backend (character_events table dropped); grep of packages/backend/src/routes finds no character/xp/alarm_completed/alarm_snoozed routes. So the iOS alarm-firing path performs ongoing work and network calls for a feature that no longer exists, repeatedly hitting now-404 endpoints and persisting a pending queue that never drains.
- **수정안**: Remove character-event emission from the alarm firing path: delete the queueAlarmEvent calls in AlarmAppContext.handleAlarmStopped/handleAlarmSnoozed (and the CharacterEventQueueing wiring), drop the StopAlarmIntent/SnoozeAlarmIntent dependence on characterEvents, and remove the characters/xp + characters/me API methods. handleAlarmStopped should retain only store.markStopped + holiday-off re-arm; handleAlarmSnoozed only store.markSnoozed.

### 🟠 Long (>30s) voice clips are never played at fire time when the phone is locked/backgrounded ❌기각(high)
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/alarm/RingingService.kt:163-197 (voice_only/alarm_voice branches), 216-251 (startVoiceLoop loops the actual voice regardless of lock state)`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmSoundResolver.swift:73-99 (>30s resolves to .cachedAudio -> AlarmKit plays only .default), AlarmVoicePlayer.swift:78-91, AlarmKitViewModel.swift:216-220 (in-app fallback only fires while app is foreground-active)`
- **차이**: Android plays the selected voice audio of ANY length as the actual ringing sound (looping with fade-in + repeat gap), whether the screen is locked or the app is dead. On iOS, AlarmKit can only play a bundled named sound <=30s; longer voices resolve to .cachedAudio, for which AlarmKit rings only the system .default tone and the voice is played by AVAudioPlayer ONLY while the app is foreground-active (processAlarmUpdate path). In the normal locked-phone alarm scenario, a >30s voice message is never heard — the user just gets a generic alarm tone. For a 'voice alarm' product this defeats the primary feature for long clips.
- **수정안**: Cannot fully match AlarmKit's 30s cap, but reduce the gap: (a) ensure voices are auto-trimmed/staged to <=30s named sounds whenever possible so they ring while locked (AlarmSoundStaging already caps at 30s — verify it always runs for voice modes), and (b) surface an explicit user-facing warning at alarm save time when a clip cannot be staged so behavior is honest. Document in describeScheduleStatus (already partially done at AlarmKitViewModel.swift:610-613) but also block silent loss by always attempting staging before falling back to .cachedAudio.

### 🟡 User-selected vibration pattern has no effect on iOS
- **분류**: missing-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/alarm/RingingService.kt:140-141, 428-441 (startVibration plays the per-alarm vibrationPattern waveform for the whole ring via VibrationPatternLibrary)`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmKitViewModel.swift:232-238 (fireForegroundRingHaptic: single .warning haptic, only when UIApplication is .active); vibrationPattern is carried in Shared/SharedAlarmCache.swift:16 but never consumed`
- **차이**: Android drives a continuous, pattern-specific vibration waveform for the entire ring based on the alarm's vibrationPattern (selectable in the editor). iOS only fires one .warning UINotificationFeedbackGenerator pulse, and only when the app is foreground-active; when locked/backgrounded AlarmKit owns a generic system vibration and the chosen pattern is ignored. The editor's VibrationPatternPicker therefore has no real effect on iOS, and there is no sustained vibration the user can rely on while the app is closed.
- **수정안**: AlarmKit does not expose custom vibration, so true parity is impossible, but make the editor honest: hide/disable the VibrationPatternPicker on iOS (or label it as on/off only mapped to AlarmKit defaults), and at minimum honor the NONE pattern by suppressing fireForegroundRingHaptic. Avoid persisting a per-pattern choice that the firing path cannot apply.

### 🟡 Per-alarm alarm volume (and 0 = mute) is not applied to the actual alarm tone
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/alarm/RingingService.kt:399-402 (applyAlarmVolume sets MediaPlayer volume from alarmVolumePercent) and :154-158 (alarmVolumePercent<=0 mutes the tone entirely)`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmVoicePlayer.swift:78-91 (alarmVolumePercent only gates/attenuates the in-app voice fallback); AlarmSoundResolver.makeAlertSound always returns .default/.named (no volume control)`
- **차이**: Android applies alarmVolumePercent directly to the ringing MediaPlayer, and treats 0 as a true mute (tone suppressed, only vibration/notification). On iOS there is no public API to set per-alarm volume on the AlarmKit system tone, so alarmVolumePercent only affects the in-app AVAudioPlayer voice fallback. The system alarm tone always rings at the device system-alarm volume. Critically, a user who sets alarm volume to 0 on iOS still gets a loud system alarm tone, the opposite of Android's silent behavior.
- **수정안**: Parity on tone volume is not possible via AlarmKit, but handle the mute case: when alarmVolumePercent == 0 and playMode is voice-capable, schedule with a near-silent staged named sound instead of .default so the user's 'mute alarm tone' intent is honored; for alarm_only + 0 volume, surface a warning that iOS cannot silence the system alarm tone. Document the volume-slider limitation in the editor for iOS.

### ⚪ ALARM_VOICE 'play voice once before fully dismissing' is not replicated
- **분류**: missing-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/alarm/RingingService.kt:457-506 (dismiss -> startDismissVoiceThenFinish plays the voice once if it hasn't played yet, then finishes)`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmKitViewModel.swift:178-181 (disappearance immediately calls AlarmVoicePlayer.shared.stop()), AlarmAppContext.swift:95-110 (handleAlarmStopped does not play voice)`
- **차이**: In ALARM_VOICE mode Android guarantees the voice message is heard at least once: if the user dismisses while the alarm tone is still playing (voice not yet started), it plays the voice once before finishing. iOS Stop immediately halts AlarmVoicePlayer and dismisses, so a user who taps Stop early never hears the voice message in that mode.
- **수정안**: In handleAlarmStopped, for records with playMode == sound_then_voice/alarm_voice whose voice has not yet played this ring (track a voiceHasPlayedThisRing flag like Android), defer the final stop until AlarmVoicePlayer plays the cached voice once, then complete the dismiss. Only feasible for the in-app fallback path while app is active; gate accordingly.

### ⚪ Snooze button is shown even when snooze is disabled or the repeat limit is reached
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ringing/RingingActivity.kt:238-244 (snooze button rendered only if snoozeEnabled) and :579-593 (snoozeAvailable = snoozeEnabled && under limit)`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmKitViewModel.swift:537-552 (secondaryButton always added), AlarmTalkWidget/AlarmLiveActivity.swift:110-131 (snooze button always rendered), AlarmIntents.swift:124-144 (.deny path stops the alarm)`
- **차이**: Android hides the snooze affordance entirely when snooze is disabled or the per-alarm repeat limit has been reached, forcing an explicit dismiss. iOS always renders the AlarmKit secondary button and the Live Activity snooze button (AlarmKit cannot hide a secondary action); pressing it in those states calls stop(id:), so the snooze button effectively acts as a second dismiss button. The end state matches but the affordance and labeling are misleading versus Android.
- **수정안**: Accept the AlarmKit constraint but make labeling honest: when a record has snooze disabled, omit the secondaryButton/secondaryIntent in makeConfiguration (AlarmKit allows a stop-only alert) and hide the LA snooze button, so a snooze-off alarm shows only Stop, matching Android.

### ⚪ Snooze intent re-arms by default when alarm state is unknown (cold boot), ignoring disabled/over-limit
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/data/AlarmRepository.kt:449-459 (snooze refuses if !snoozeEnabled or count >= limit, always reading the DB)`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmIntents.swift:124-144 (decision == .unknown falls through to countdown re-arm), AlarmAppContext.swift:150-154 (returns .unknown when store not loaded or record missing)`
- **차이**: Android's snooze always reads the persisted alarm and never snoozes a disabled or over-limit alarm. iOS resolves a 3-state decision and, when the store has not finished loading from disk or the record is not found (.unknown), defaults to re-arming via countdown(id:) even for an alarm whose snooze is disabled or whose limit is reached. This is acknowledged as deliberate (avoid wrongly killing the alarm), but it diverges from Android's guarantee and can grant an extra snooze the user disabled.
- **수정안**: Synchronously ensure the LocalAlarmStore is loaded before the LiveActivityIntent decision (e.g. block on a fast disk read in snoozeDecision) so .unknown is rare, or persist a lightweight snooze-eligibility flag in the shared App Group cache (SharedAlarmSnapshot) that the intent can read without the full store, making the over-limit/disabled decision deterministic at cold boot.

### ⚪ In-app fallback voice gain is multiplied by alarmVolumePercent; Android uses only voiceVolumePercent
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/alarm/RingingService.kt:404-413 (applyVoiceVolume uses VoiceVolumeRamp.plan(volumePercent = voiceVolumePercent) only)`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmVoicePlayer.swift:171-174 and :301-305 (combinedVolumePercent = voicePercent * alarmPercent / 100)`
- **차이**: Android applies only voiceVolumePercent to the voice player's ramp/target; alarmVolumePercent governs the separate alarm tone, not the voice. iOS folds alarmVolumePercent into the voice fallback gain (voice% x alarm%), so the same alarm (e.g. voice 100%, alarm 50%) plays the voice at half the level Android would. This makes the voice quieter than the Android equivalent for any alarmVolumePercent < 100.
- **수정안**: Drop the multiplication: set currentVoiceVolumePercent from voiceVolumePercent alone (keep the alarmVolumePercent == 0 early-return as the mute gate), matching VoiceVolumeRamp.targetVolume(voiceVolumePercent) on Android.

### ⚪ Timezone/time-change re-arm for holiday-off one-shots only runs while the app is alive
- **분류**: error-handling
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/alarm/BootCompletedReceiver.kt:23-41 (re-arms on BOOT_COMPLETED, MY_PACKAGE_REPLACED, TIMEZONE_CHANGED, TIME_CHANGED via reschedulePendingAlarms, even with app not running)`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmTalkApp.swift:238-263 (observeTimeAndTimezoneChanges runs only inside the live Scene .task)`
- **차이**: Android's broadcast receiver recomputes alarm fire times after reboot AND after timezone/clock changes regardless of whether the app is foregrounded. iOS relies on AlarmKit persistence for the already-scheduled instant (so the alarm still fires after reboot), but the holiday-skip recompute for .fixed holiday-off one-shots only happens via NSSystemTimeZoneDidChange / significantTimeChange observers that exist only while the app process is alive. After a reboot or a timezone change with the app closed, a .fixed one-shot can fire at the pre-change absolute instant (wrong wall-clock time) until the user next opens the app.
- **수정안**: Schedule .fixed holiday-off one-shots with AlarmKit's relative/recurrent schedule where possible so the OS re-anchors them, or register a BGAppRefreshTask / use the existing BackgroundSyncTask re-arm sweep to recompute holiday-off fire times opportunistically in the background; document the residual gap that iOS cannot run code at reboot like Android's BootCompletedReceiver.

---

## [character-removal] Stale Character/Growth feature on iOS — `major-gaps`

iOS still ships the entire Character/Growth feature that Android fully removed (character_events table dropped in AlarmDatabase.kt:73-78 and :170-175; no Android FE surface remains). The feature spans ~20 iOS files: a local event store/persistence, two API endpoints (characters/me, characters/xp) that no longer exist on the backend (no route file, nothing mounted in index.ts) nor in packages/shared, the SocialFeatureViewModel.character state, two UI surfaces (HomeView CharacterMiniCard + Settings GrowthPanel reachable from the MainTabsView profile menu), shared HelperFormatters helpers, app-level wiring in AlarmTalkApp/AlarmAppContext, and 4 test files. Most surfaces are pure-delete, but AlarmAppContext.swift and AlarmAppContextTests.swift are mixed (character queueing entangled with live dismiss/snooze alarm logic) and must be stripped, not deleted. Because XcodeGen (project.yml) uses directory-glob sources, deleting files needs no project-file edit.

### 🟠 Delete CharacterEventStore.swift (store + persistence + XP-grant protocol) ✅(high)
- **분류**: stale-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/data/AlarmDatabase.kt:170-175 (DROP TABLE character_events)`
- **iOS**: `apps/ios-native/AlarmTalk/CharacterEventStore.swift:1-325`
- **차이**: Entire iOS port of Android's removed CharacterEventRepository + CharacterEventSyncService: CharacterEventPersistence (JSON store), CharacterXPGranting protocol, CharacterEventStore (queue/flush/nonce), and the CharacterEventQueueing conformance. Android deleted this whole layer (character_events table dropped). The store's flushPending() calls api.grantCharacterXP against a backend endpoint that no longer exists.
- **수정안**: Delete the file CharacterEventStore.swift in full. XcodeGen globs the AlarmTalk/ dir so no project.yml change is needed; just remove the file and regenerate.

### 🟠 Delete CharacterEventEntity.swift (Room-entity port + enums) ✅(high)
- **분류**: stale-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/data/AlarmDatabase.kt:73-78 (character_events table no longer in schema)`
- **iOS**: `apps/ios-native/AlarmTalk/CharacterEventEntity.swift:1-86`
- **차이**: iOS port of Android's CharacterEventEntity Room row plus CharacterEventType (alarm_completed/alarm_snoozed) and CharacterEventSyncState enums. Android removed the entity and table entirely.
- **수정안**: Delete CharacterEventEntity.swift in full.

### 🟠 Remove dead character API methods + conformance from AlarmTalkAPI.swift ✅(high)
- **분류**: stale-feature
- **Android**: `n/a (Android removed getCharacter/grantXp client calls)`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmTalkAPI.swift:494-535, 965-970`
- **차이**: getCharacter(token:) GETs characters/me and grantCharacterXP(...) POSTs characters/xp. Neither endpoint exists in packages/backend (no route file; nothing mounted in index.ts) nor in packages/shared schemas, so both calls 404. Also the CharacterXPGranting conformance extension at 965-970.
- **수정안**: Delete getCharacter (494-496), both grantCharacterXP overloads (498-535), and the `extension AlarmTalkAPI: CharacterXPGranting {}` block (965-970).

### 🟠 Strip character state + dead refresh/grant from SocialFeatureViewModel.swift ✅(high)
- **분류**: stale-feature
- **Android**: `n/a (Android MainViewModel no longer loads character)`
- **iOS**: `apps/ios-native/AlarmTalk/SocialFeatureViewModel.swift:20, 75, 147-157, 823-842`
- **차이**: @Published var character (20) and its reset (75); the getCharacter block inside refreshAll (147-157) which calls the dead characters/me endpoint and surfaces a user-facing error '성장 정보를 불러오지 못했어요' on every refresh; and grantWakeupXP (823-842) which posts to the dead characters/xp endpoint (and is itself dead code — no callers).
- **수정안**: Remove the `character` published property and its reset, delete the getCharacter do/catch block in refreshAll, and delete grantWakeupXP entirely.

### 🟠 Strip CharacterEvent queueing from AlarmAppContext.swift (do NOT delete file) ✅(high)
- **분류**: stale-feature
- **Android**: `n/a (Android dismiss/snooze no longer emits character events)`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmAppContext.swift:3-35, 57-63, 82-86, 112-135, 169-197`
- **차이**: This file mixes removed character-event queueing with live alarm logic. Character-only parts: CharacterEventKind enum (22-25), CharacterEventQueueing protocol (3-35), `weak var characterEvents` (57) and `queueing` computed prop (59-63), the `characterEvents:` init parameter (82-86), and the queueAlarmEvent + buildClientNonce calls inside handleAlarmStopped (112-135) and handleAlarmSnoozed (174-178, 186-197). The markStopped/markSnoozed/holiday-rearm/snoozeDecision logic MUST be preserved.
- **수정안**: Delete the enum/protocol, the characterEvents weak ref + queueing computed prop, drop the characterEvents init param, and remove the nonce+queueAlarmEvent tails of handleAlarmStopped and handleAlarmSnoozed while keeping markStopped/markSnoozed/rearm/guard logic intact.

### 🟠 Remove characterEvents store wiring from AlarmTalkApp.swift ✅(high)
- **분류**: stale-feature
- **Android**: `n/a (Android app has no character event store)`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmTalkApp.swift:26-33, 58, 84-87, 114, 155, 202`
- **차이**: @StateObject characterEvents = CharacterEventStore(...) (26-33); .environmentObject(characterEvents) (58); the `characterEvents: characterEvents` argument to the AlarmAppContext init (84-87); await characterEvents.loadFromDisk() (114); await characterEvents.flushPending() in the auth-token task (155); and Task { await characterEvents.flushPending() } on scenePhase .active (202).
- **수정안**: Remove the @StateObject, the environmentObject injection, the characterEvents init argument (matching the stripped AlarmAppContext init), and the three loadFromDisk/flushPending call sites.

### 🟡 Delete Views/Home/CharacterMiniCard.swift (home growth summary card)
- **분류**: stale-feature
- **Android**: `n/a (removed from Android home)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Home/CharacterMiniCard.swift:1-66`
- **차이**: Home-screen card showing character stage emoji, LV, streak, and XP progress, reading SocialFeatureViewModel.character. Android's home has no such card after the feature removal.
- **수정안**: Delete CharacterMiniCard.swift, then remove its usage in HomeView (see HomeView finding).

### 🟡 Delete Views/Settings/GrowthPanel.swift (캐릭터 성장 panel + subviews)
- **분류**: stale-feature
- **Android**: `n/a (removed from Android settings)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Settings/GrowthPanel.swift:1-279`
- **차이**: Full growth panel (stage/level/streak/stats/XP, sync status, recent-events list) plus private CharacterSummaryView, CharacterEmptyStateView, CharacterSyncStatusView, CharacterEventRecordRow and eventXp helpers. Depends on socialFeatures.character, CharacterEventStore, and HelperFormatters character helpers. Android has no equivalent settings surface.
- **수정안**: Delete GrowthPanel.swift in full, then remove its routing (AuxiliarySheetHost / AuxiliaryScreen / MainTabsView findings).

### 🟡 Remove character DTO structs from AlarmTalkAPIModels.swift
- **분류**: stale-feature
- **Android**: `n/a (Android removed character DTOs)`
- **iOS**: `apps/ios-native/AlarmTalk/AlarmTalkAPIModels.swift:713-778`
- **차이**: Decodable/Encodable models with no backend counterpart: CharacterResponse, CharacterPayload, CharacterProgress, CharacterStreak, CharacterStats, StreakAchievement, CharacterXpRequest, CharacterGrantResponse, CharacterGrant. None appear in packages/shared.
- **수정안**: Delete the entire block of these structs (lines 713-778). StreakAchievement/CharacterGrant are only referenced by these removed types and the deleted tests, so they go too.

### 🟡 Remove CharacterMiniCard usage from HomeView.swift
- **분류**: stale-feature
- **Android**: `n/a (Android home has no growth card)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Home/HomeView.swift:45-47`
- **차이**: `CharacterMiniCard { openAuxiliary(.growth) }` renders the home growth card and navigates to the growth sheet.
- **수정안**: Delete the CharacterMiniCard { openAuxiliary(.growth) } block (45-47).

### 🟡 Remove .growth route from AuxiliarySheetHost.swift
- **분류**: stale-feature
- **Android**: `n/a (Android has no growth aux sheet)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Auxiliary/AuxiliarySheetHost.swift:57-58`
- **차이**: The `.growth` switch case renders GrowthPanel() inside the auxiliary sheet host.
- **수정안**: Delete the `case .growth: GrowthPanel()` arm (57-58).

### 🟡 Remove growth case from AuxiliaryScreen enum
- **분류**: stale-feature
- **Android**: `n/a (Android has no growth screen)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Auxiliary/AuxiliaryScreen.swift:10, 19`
- **차이**: `case growth` (10) and its title `case .growth: return "캐릭터"` (19) in the AuxiliaryScreen enum.
- **수정안**: Remove the growth enum case and its title mapping; verify the switch over screens remains exhaustive after removal.

### 🟡 Remove 캐릭터 profile-menu entry from MainTabsView.swift
- **분류**: stale-feature
- **Android**: `n/a (Android profile menu has no character entry)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Root/MainTabsView.swift:68-72`
- **차이**: Profile toolbar Menu button labeled '캐릭터' (sparkles icon) that sets auxiliaryScreen = .growth (68-72). This is the navigation entry point into the stale GrowthPanel.
- **수정안**: Delete the Button { auxiliaryScreen = .growth } label { Label("캐릭터", ...) } block (68-72). Update the doc comment at line 34 that says 'People/Growth/Billing'.

### 🟡 Strip character-event assertions from AlarmAppContextTests.swift (do NOT delete file)
- **분류**: stale-feature
- **Android**: `n/a (tests a mixed context)`
- **iOS**: `apps/ios-native/AlarmTalkTests/AlarmAppContextTests.swift:8, 25-26, 40-145, 205-225`
- **차이**: Mixed test file: it exercises both removed character queueing (mockQueue/MockCharacterEventQueue at 205-225, the `characterEvents:` ctx init at 26, queued-event + nonce assertions at 40-99 and 119-133) AND surviving alarm logic (snooze advances/limit/disabled/repeating-armed). After stripping AlarmAppContext, the queueing assertions and MockCharacterEventQueue won't compile.
- **수정안**: Remove MockCharacterEventQueue, the mockQueue property/setup, the `characterEvents:` init argument, and all mockQueue/nonce assertions, while keeping the markStopped/markSnoozed/snoozeDecision behavioral assertions.

### ⚪ Delete CharacterEventPersistenceTests.swift
- **분류**: stale-feature
- **Android**: `n/a (test for removed feature)`
- **iOS**: `apps/ios-native/AlarmTalkTests/CharacterEventPersistenceTests.swift:1-90`
- **차이**: Unit tests for CharacterEventPersistence (atomic JSON save/load, corruption handling). Entirely tied to the removed feature.
- **수정안**: Delete CharacterEventPersistenceTests.swift in full.

### ⚪ Delete CharacterEventStoreTests.swift
- **분류**: stale-feature
- **Android**: `n/a (test for removed feature)`
- **iOS**: `apps/ios-native/AlarmTalkTests/CharacterEventStoreTests.swift:1-310`
- **차이**: Unit tests for CharacterEventStore queue idempotency, nonce determinism, sync success/failure, and CharacterEventQueueing bridging. Includes a mock CharacterXPGranting at line 305. Entirely tied to the removed feature.
- **수정안**: Delete CharacterEventStoreTests.swift in full.

### ⚪ Remove character stage helpers from HelperFormatters.swift
- **분류**: stale-feature
- **Android**: `n/a (Android stageEmoji/stageLabel removed)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Common/HelperFormatters.swift:27-50`
- **차이**: characterStageEmoji, characterStageName, and the compat alias characterStageLabel. Only consumed by CharacterMiniCard and GrowthPanel (both being deleted) and HelperFormattersTests.
- **수정안**: Delete the three static functions (lines 27-50).

### ⚪ Remove CharacterEventStore preview from PreviewSupport.swift
- **분류**: stale-feature
- **Android**: `n/a (preview-only helper for removed feature)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Common/PreviewSupport.swift:34-39, 65`
- **차이**: `extension CharacterEventStore { static var preview }` (34-39) and `.environmentObject(CharacterEventStore.preview)` in the shared PreviewEnvironment modifier (65). After deleting CharacterEventStore these fail to compile.
- **수정안**: Delete the CharacterEventStore preview extension (34-39) and the environmentObject(CharacterEventStore.preview) line (65).

### ⚪ Remove character stage tests from HelperFormattersTests.swift
- **분류**: stale-feature
- **Android**: `n/a (test for removed helpers)`
- **iOS**: `apps/ios-native/AlarmTalkTests/HelperFormattersTests.swift:6-22`
- **차이**: test_characterStageEmoji_matchesAndroidStageEmoji (6-13) and test_characterStageName_matchesAndroidStageLabel (15-22) test the HelperFormatters character helpers being deleted.
- **수정안**: Delete both test methods (6-22).

### ⚪ Clean up stale character/growth doc-comment references
- **분류**: stale-feature
- **Android**: `n/a (comments only)`
- **iOS**: `apps/ios-native/AlarmTalk/ContentView.swift:14,20; apps/ios-native/Shared/AlarmIntents.swift:30,35; apps/ios-native/AlarmTalk/Views/Settings/BillingPanelComponents.swift:652; apps/ios-native/AlarmTalk/AlarmKitViewModel.swift:149,181`
- **차이**: Dangling doc comments referencing the removed feature: ContentView screen-map lists CharacterMiniCard.swift (14) and GrowthPanel.swift (20); AlarmIntents.swift references CharacterEventStore.queue/markStopped (30,35); BillingPanelComponents notes MetricTile is used by '캐릭터 패널' (652 — MetricTile itself stays, used by billing); AlarmKitViewModel comments mention 'CharacterEvent emit' (149,181). These won't break the build but reference deleted symbols.
- **수정안**: Update/remove these comments so they no longer reference CharacterMiniCard, GrowthPanel, or CharacterEventStore; keep MetricTile but drop the character wording in its comment.

---

## [alarm-core] Alarm scheduling, time logic & sync — `minor-gaps`

The core domain is a high-fidelity port: AlarmTimeCalculator satisfies the Android AlarmTimeCalculatorTest spec exactly (timezone-aware next-fire, today/tomorrow boundary, repeat next-selected-day, holiday-off skip, Sun=0..Sat=6 bitmask, 0..7/8..21 lookahead, mask validation), the wire contract matches the backend and Android 1:1 (paths, HTTP methods, snake_case keys via convertTo/FromSnakeCase, timezone/wake_mode/mode/repeat_days, RemoteAlarm field names), and local<->remote mapping, list sort order, validateDraft, snooze/dismiss/setEnabled/boot-restore, push candidate filter, and received-enabled resolution all align. Divergences are confined to pull-side merge/conflict/cascade semantics where iOS added behavior that Android's pull does not have. Overall: minor gaps, no contract or time-math breakage.

### 🟡 iOS cascade-deletes orphaned received-remote alarms; Android retains them
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/data/RemoteAlarmPullSyncService.kt:27-111 (pullReceivedAlarms loop only upserts; no orphan deletion anywhere)`
- **iOS**: `apps/ios-native/AlarmTalk/RemoteAlarmPullSync.swift:147 and :254-262 (pruneOrphanReceivedRemotes)`
- **차이**: On every pull, iOS computes the set of all server alarm IDs and cancels/removes any local origin==receivedRemote record whose remoteAlarmId is no longer returned by the server (e.g. the sender deleted/un-shared the alarm or revoked the relationship). Android's pull (RemoteAlarmPullSyncService.pullReceivedAlarms) has NO such pruning step at all — it only upserts the alarms present in the response, so a received alarm that disappears server-side persists indefinitely as a ghost on Android until manually deleted. The iOS comment even claims parity ('서버에서 사라진 receivedRemote 알람은 cascade 삭제') with Android, but Android does not implement this. Net effect: a server-side deletion propagates to the iOS recipient automatically but never to the Android recipient.
- **수정안**: To strictly match the Android baseline, remove the pruneOrphanReceivedRemotes call at RemoteAlarmPullSync.swift:147 (and its impl) so iOS, like Android, only upserts alarms present in the response and never auto-deletes received alarms on pull. (Alternatively, if the product wants this cleanup, the parity gap should instead be closed by ADDING the same orphan-prune to Android's RemoteAlarmPullSyncService — but per the Android-is-source-of-truth directive, the iOS change is to drop the prune.)

### 🟡 Editing a received-remote alarm marks it 'dirty' on iOS (Android keeps it 'synced'), freezing server sync
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/data/AlarmRepository.kt:788-793 (nextLocalSyncState: RECEIVED_REMOTE -> SYNCED) used by updateAlarm:240`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Editor/AlarmEditDraft.swift:288-290 (syncState = existing.remoteAlarmId==nil ? localOnly : dirty — no origin check)`
- **차이**: Android's single sync-state rule (nextLocalSyncState) forces origin==received_remote alarms back to SYNCED on any edit, so the server stays authoritative and the next pull re-applies server state over the user's local change. iOS's editor save path (AlarmEditDraft.makeRecord) instead sets dirty whenever remoteAlarmId != nil, ignoring origin. Received alarms DO have a remoteAlarmId and ARE editable on iOS (AlarmsListView.swift:88 opens the editor via openEditor(.edit(alarm.id)) for every alarm regardless of origin). A received alarm edited on iOS therefore becomes syncState=dirty, and the pull guard (shouldApplyRemote returns false when existing.syncState==.dirty) then permanently skips future server updates for that alarm, while push never sends it (push filter requires origin==localOwned). The alarm is effectively frozen — opposite of Android, where local edits to received alarms are reverted on the next pull. Note iOS's setEnabled path (LocalAlarmStore.nextLocalSyncState, LocalAlarmStore.swift:430-434) correctly mirrors Android; only the editor draft path diverges.
- **수정안**: In AlarmEditDraft.swift:288-290, replace the inline two-way branch with the store's nextLocalSyncState logic so origin==received_remote yields .synced (matching Android): e.g. compute syncState as existing.origin==received_remote ? synced : (existing.remoteAlarmId==nil ? localOnly : dirty). Ideally reuse LocalAlarmStore.nextLocalSyncState(for:) as the single source of truth instead of duplicating the rule.

### ⚪ iOS pull adds a last-write-wins / dirty conflict gate that Android's pull does not have
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/data/RemoteAlarmPullSyncService.kt:64-93 (always rebuilds existing via buildLocalAlarm and upserts; no LWW or dirty check)`
- **iOS**: `apps/ios-native/AlarmTalk/RemoteAlarmPullSync.swift:160 and :222-225 (shouldApplyRemote: skip if existing.syncState==.dirty or mapped.lastSyncedAtMillis < existing.lastSyncedAtMillis)`
- **차이**: Android's pull unconditionally re-derives an existing received alarm from the server response and upserts it (preserving only a fixed set of local fields). iOS adds a conflict gate (shouldApplyRemote) that returns .unchanged when the existing record is dirty or when the mapped lastSyncedAtMillis is older. For the normal received-alarm flow this is largely inert (mapped.lastSyncedAtMillis is always 'now' so the LWW arm never blocks, and received alarms are not normally dirty), so on its own it rarely changes behavior. However it is the mechanism that, together with the AlarmEditDraft dirty divergence above, causes edited received alarms to stop syncing on iOS. It is a real Android-absent code path in the pull/merge logic.
- **수정안**: To match Android's always-apply-on-pull semantics, either drop the shouldApplyRemote gate (RemoteAlarmPullSync.swift:160/222-225) so iOS always applies server state to existing received alarms, or restrict the guard to never apply to origin==receivedRemote so the server remains authoritative for received alarms exactly as on Android. Fixing the AlarmEditDraft syncState finding also neutralizes the practical impact.

---

## [billing] Billing & subscription — `minor-gaps`

The core money path is sound: product IDs and tiers map correctly (Apple `com.voicealarm.nativeapp.ios.*_monthly` vs Google `*_monthly`, both resolving to personal/couple/family on the backend), the purchase->server-confirm flow uses the right per-store endpoints (iOS POST /billing/apple/confirm, Android POST /billing/google/confirm), the request/response field names match the backend snake_case contract, and the server-side entitlement model (applyStoreEntitlement -> subscriptions table) is identical for both stores. The divergences are concentrated in (a) feature-gating triggers and (b) UI structure/styling of the billing surfaces. The biggest behavioral gap: iOS blocks the entire Voices tab behind a paid plan, whereas Android opened the Voices tab to all logged-in users (stock voices for free). There are also missing lock badges, mismatched gate copy, an over-built PlanGateDialog, and billing cards that ignore the Android Waker design tokens. Verdict: minor-gaps with several concrete fixes needed.

### 🟠 iOS gates the entire Voices tab behind a paid plan; Android lets all logged-in users in ✅(high)
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/app/AlarmTalkApp.kt:371-387 (navigateToTab gates ONLY Messages); apps/android-native/app/src/main/java/com/alarmtalk/app/ui/alarms/AlarmListScreen.kt:129`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Root/MainTabsView.swift:182-195`
- **차이**: Android's navigateToTab only plan-gates the Messages tab; the Voices tab has no navigation gate and free/logged-in users enter it (Android comment: '시스템 스톡 보이스 도입으로 음성 기능은 로그인만 하면 열린다 (무료는 스톡 보이스 한정)'). Inside the Voices panel Android only locks the *create* affordance via hasPaidVoiceAccess. iOS's planGateFor(.voices) returns a full-screen PlanGateState whenever !currentPlan.meetsOrExceeds(.personal), so a free iOS user is blocked from even opening the Voices tab. This is a meaningful behavioral regression vs the baseline: free iOS users cannot browse stock voices the way free Android users can.
- **수정안**: Remove the `.voices` case from MainTabsView.planGateFor (return nil for .voices) so the Voices tab is always reachable when logged in, matching Android. Move the paid gating down into the voice-creation action inside the Voices panel (lock the create button with FeatureLockBadge / show voices_paid_required copy), exactly as Android's VoiceProfileManagementPanel does with canCreateVoice = hasPaidVoiceAccess.

### 🟡 Messages tab is missing the bottom-nav lock badge that Android shows
- **분류**: missing-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/app/AlarmTalkBottomBar.kt:89-98,173-189 (locked=messagesLocked draws a lock circle); source at AlarmTalkApp.kt:465`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Root/BottomNavBar.swift:24-48 (only unread count badge, no lock)`
- **차이**: Android renders a small lock badge (Icons.Outlined.Lock in a surface circle at TopEnd, offset x=9,y=-4, size 15dp) on the Messages tab icon whenever !hasCoupleOrFamilyAccess, and suppresses the unread badge while locked. iOS BottomNavBar has no lock concept at all for any tab; it only draws the numeric unread badge. So locked Messages/Voices tabs do not visually communicate that they are gated on iOS.
- **수정안**: Add a `locked` flag to BottomNavBar per-tab (computed from currentPlan/canUseMessages) and overlay a lock glyph on the icon (lock.fill in a surface-colored circle at top-trailing) matching Android's placement/size. Suppress the numeric badge when locked, as Android does.

### 🟡 Messages plan-gate dialog uses the wrong (generic) title vs Android's messages-specific title
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/app/AlarmTalkApp.kt:379-382 -> R.string.r3app_messages_plan_gate_title = '함께 쓰는 기능이에요' (strings.xml:1060)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Root/MainTabsView.swift:202-208 (title: '이용권이 필요한 기능이에요')`
- **차이**: Android's Messages gate uses the dedicated title r3app_messages_plan_gate_title ('함께 쓰는 기능이에요'). iOS reuses the generic title string '이용권이 필요한 기능이에요' (which is actually Android's r3dlg_plan_gate_title, used for unrelated dialogs) for the Messages gate. The body ('메시지는 커플/가족 이용권에서 사용할 수 있어요.') and confirm label ('이용권 보기') do match Android. Only the title is wrong.
- **수정안**: Change the .messages PlanGateState title in MainTabsView to '함께 쓰는 기능이에요' to match r3app_messages_plan_gate_title.

### 🟡 PlanGateDialog is structurally heavier than Android (extra lock badge + plan-progression row, bottom-sheet vs centered modal)
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/components/PlanGateDialog.kt:26-78`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Common/PlanGateDialog.swift:36-115`
- **차이**: Android's PlanGateDialog is a centered modal (Dialog + Surface, WakerDialogShape 28dp, shadowElevation 18dp) containing only: a title row with a close X (ModalDialogTitle), a bodyMedium message, and a single full-width confirm Button (WakerButtonShape 18dp). iOS's version (whose doc comment claims a '1:1 포팅') adds a 58pt FeatureLockBadge, a '현재 플랜: X  →  필요: Y' progression row with a surfaceVariant rounded(14) background, and presents as a bottom sheet (.presentationDetents([.fraction(0.45), .medium]) + drag indicator) rather than a centered dialog. Container/button corner radii (14 vs 28/18) and the presentation style also differ.
- **수정안**: Rebuild PlanGateDialog to mirror Android: centered modal (not bottom sheet), title + close X, message text, single confirm button; drop the FeatureLockBadge and the current->required progression row that Android does not have. Apply the equivalent of WakerDialogShape (28) for the container and WakerButtonShape (18) for the button instead of 14.

### 🟡 Billing cards ignore Android design tokens (8pt corners + legacy theme instead of WakerCardShape 22 / primaryContainer)
- **분류**: styling-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/billing/BillingPanels.kt:607-644 (CurrentPassSummaryCard: WakerCardShape=22dp, primaryContainer.copy(alpha=0.36)), :694-711 (PlanCard: WakerCardShape, primaryContainer/surface)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Settings/BillingPanelComponents.swift:34-41 (CurrentPassSummaryCard RoundedRectangle cornerRadius:8, AlarmTalkTheme.primary.opacity(0.10)), :243-246 (PlanCard cornerRadius:8, AlarmTalkTheme.surfaceVariant)`
- **차이**: Android's billing cards use the Waker design tokens: WakerCardShape (22dp) for the summary card and plan cards, with primaryContainer-based fills and wakerCardBorder. iOS's CurrentPassSummaryCard and PlanCard use raw RoundedRectangle(cornerRadius: 8) and the legacy AlarmTalkTheme palette (primary.opacity(0.10), surfaceVariant), not the voiceAlarmTheme/Waker tokens used elsewhere on iOS. This violates the 'match Android tokens down to corner radius' goal (22 vs 8) and uses a different color model.
- **수정안**: Switch the billing cards to the iOS equivalent of WakerCardShape (22pt continuous corners) and the voiceAlarmTheme palette (primaryContainer at the matching alpha, theme border), consistent with PlanGateDialog/FeatureLockBadge which already use theme.palette. Replace the cornerRadius:8 literals and AlarmTalkTheme.* with the token-based shapes/colors.

### 🟡 iOS plan cards omit the per-plan feature bullet list that Android renders
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/billing/BillingPanels.kt:91-134 (each option has a features list) and :759-766 (rendered as PlanFeatureRow bullets)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Settings/BillingPanelComponents.swift:197-201,310-317 (single-line description string only)`
- **차이**: Android's SubscriptionPlanCard shows a bulleted feature list (3 features per paid plan, e.g. voice/voice-message/gift for personal) via PlanFeatureRow with a primary dot. iOS PlanCard shows only a single description line (Self.description(for:)). The current-plan indicator copy also differs: Android pill = '현재 이용권' (billing_current_pass_label, strings.xml:86) while iOS pill = '이용 중'. So iOS conveys less per-plan information and uses different current-state copy.
- **수정안**: Add the per-plan feature bullet list to iOS PlanCard (matching the Android billing_plan_*_feature_* strings, rendered as dot + text rows), and change the current-plan pill text from '이용 중' to '현재 이용권' to match billing_current_pass_label.

### 🟡 Client-side entitlement source differs: iOS unlocks via StoreKit (bestKnown) even without an active server subscription; Android requires an active server subscription
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/util/PlatformAndLabelUtils.kt:259-265 (hasPaidVoiceAccess requires subscription.status=='active'); :227-237 (hasCoupleOrFamilyAccess)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Root/MainTabsView.swift:214-224 and apps/ios-native/AlarmTalk/AccessSnapshotStore.swift / PlanGateDialog.swift:212-228 (PlanTier.bestKnown(server, storeTier, userPlan)); apps/ios-native/AlarmTalk/VoiceShareAccess.swift:10-23`
- **차이**: Android gating is driven purely by the server subscription (must be status=='active' with a paid plan key/type). iOS gating uses PlanTier.bestKnown, which takes the MAX of (StoreKit currentTier, server plan when active, and session user.plan when no server sub). This means iOS can treat a user as paid based on the local StoreKit entitlement even when the backend confirm failed or the server marks the subscription inactive — a state Android cannot reach. The server entitlement model itself is identical; this is a client read-model divergence that changes which features unlock in confirm-failure / cancelled-but-not-expired edge cases.
- **수정안**: Acceptable as intentional IAP resilience, but to match Android's behavior the StoreKit storeTier should only be additive while a backend sync is pending/unconfirmed, and should defer to the server subscription status once known (e.g., don't count storeTier when serverSubscription.status is a definitive non-active state). At minimum, document and align the precedence so gating decisions match Android for known server states.

### ⚪ iOS adds a FeatureLockBadge(tier) chip on each paid plan card; Android plan cards have no such badge
- **분류**: stale-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/billing/BillingPanels.kt:718-755 (plan card header has no lock badge)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Settings/BillingPanelComponents.swift:193-196 (FeatureLockBadge(size:20,iconSize:11,tier:tier) next to plan name)`
- **차이**: iOS renders a FeatureLockBadge with a tier label chip ('개인'/'커플'/'가족') beside each paid plan's name on the billing plan cards. Android's plan cards show no lock badge in the header (it only shows the plan name, price, and a 'current' pill). This is extra iOS-only UI not present in the Android baseline.
- **수정안**: Remove the FeatureLockBadge(tier:) from PlanCard's header (BillingPanelComponents.swift:193-196) so plan cards match Android's name/price/current-pill layout.

### ⚪ FeatureLockBadge uses a filled lock + tier-label variant; Android uses an outline lock with no label
- **분류**: styling-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/components/FeatureLockBadge.kt:19-42 (Icons.Outlined.Lock, no tier label, default 22/12)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Common/FeatureLockBadge.swift:18-50 (Image('lock.fill'), plus optional tier-label Capsule chip)`
- **차이**: Android's FeatureLockBadge is a single primaryContainer circle with an OUTLINE lock icon and a 1dp surface border, with no text. iOS uses a FILLED lock (lock.fill) and adds an optional tier-label Capsule chip ('개인'/'커플'/'가족') when a tier is supplied. The default circle sizes (22/12) match, but the icon style (outline vs fill) and the extra tier-label variant deviate.
- **수정안**: Use an outline lock SF Symbol (e.g. 'lock') to match Android's Icons.Outlined.Lock, and remove the tier-label chip variant unless a corresponding Android usage exists (it does not), keeping the badge a plain lock circle.

### ⚪ No in-app change-plan flow on iOS (Android exposes upgrade/downgrade with at_period_end vs immediate)
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/billing/BillingPanels.kt:767-799 ('변경' button -> ChangePlanDialog) and apps/android-native/app/src/main/java/com/alarmtalk/app/ui/main/MainViewModelGrowthBillingActions.kt:600-640 (POST /billing/change-plan with mode)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Settings/BillingPanelComponents.swift:248-308 (price button only; changePlan API exists at AlarmTalkAPI.swift:616-623 but is never invoked from UI)`
- **차이**: When a user already has an active subscription, Android's plan card shows a '변경' (change) button that opens ChangePlanDialog letting the user pick 'at_period_end' vs 'immediate' and calls /billing/change-plan. iOS has no change-plan UI: each plan card shows a StoreKit price button and relies on Apple's subscription-group up/downgrade semantics; the changePlan() API method exists but is unused. The user therefore cannot explicitly schedule a period-end downgrade in-app the way Android allows.
- **수정안**: Largely platform-justified (StoreKit must drive Apple plan changes), but for parity surface the scheduled-change state and, where applicable, present an equivalent change affordance. At minimum ensure a subscribed user tapping another tier triggers the StoreKit upgrade/downgrade path (not a duplicate 'new' purchase) and reflect the resulting nextPlan in CurrentPassSummaryCard as Android does.

---

## [social-family] Family, friends, gifts, members, messages — `minor-gaps`

The wire contract is faithfully matched: every social endpoint (family/groups/current, /leave, members DELETE, code/register, notes POST + /received + /{id}/audio + /{id}/read, family/alarms/voice, billing/vouchers/family-share, user/me PATCH for quiet-time) uses the same path/method/fields as Android and the backend, and the iOS `listReceivedNotes` omitting limit/offset is equivalent because the backend defaults to 20 = Android's explicit value. Notification copy and the received-alarm label ("{name}님이 보낸 알람") match exactly. The primary flows (join-by-code, leave, remove member, member roles, quiet-time editor, text/voice message send, play/mark-read, badge counting) are present and behave the same. The notable gaps are: (1) iOS still ships the removed Character/Growth feature inside SocialFeatureViewModel, and its per-refresh `getCharacter` call surfaces a recurring error into the messages panel; (2) iOS lacks the owner "재발급(regenerate share code)" feature entirely; plus several UI/logic divergences (missing tab lock indicator, voice-message text reveal gating, success-toast on refresh, recipient cap). Verdict: minor-gaps with one high-severity stale-feature item.

### 🟠 Stale Character/Growth feature still in social view model; getCharacter() error leaks into messages panel on every refresh ✅(high)
- **분류**: stale-feature
- **Android**: `n/a (Character/Growth removed FE+BE; no Character API in apps/android-native; packages/backend/src/routes has no character*.ts)`
- **iOS**: `apps/ios-native/AlarmTalk/SocialFeatureViewModel.swift:20,147-157,823-842 ; apps/ios-native/AlarmTalk/AlarmTalkAPI.swift:494-535`
- **차이**: iOS SocialFeatureViewModel still declares `@Published var character`, calls `api.getCharacter(token:)` inside refreshAll (lines 147-157), and exposes grantWakeupXP/grantCharacterXP. Android removed Character/Growth entirely (FE+BE, character_events dropped) and the backend has no characters/me or characters/xp route. On iOS, refreshAll runs on entering the Messages tab and MemberManagementView; the getCharacter call 404s, the catch appends '캐릭터: 성장 정보를 불러오지 못했어요' to `statusMessage` (line 176-177), and VoiceMessagePanel renders that statusMessage inline (VoiceMessagePanel.swift:28-32) — a recurring user-visible error.
- **수정안**: Remove the Character feature from the social path on iOS: delete the `character` property, the getCharacter block in refreshAll (lines 147-157), grantWakeupXP, and the getCharacter/grantCharacterXP API methods + CharacterResponse models, matching Android's removal.

### 🟡 Missing 'regenerate share code' (owner) feature in Member Management
- **분류**: missing-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/members/MemberManagementScreen.kt:243-256,317-353 ; ui/main/MainViewModelGrowthBillingActions.kt:526-553 ; network/BillingApi.kt:150-153 (POST billing/vouchers/family-share/regenerate)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Members/MemberManagementView.swift:216-277 ; apps/ios-native/AlarmTalk/SocialFeatureViewModel.swift:433-457 ; apps/ios-native/AlarmTalk/AlarmTalkAPI.swift:598-605`
- **차이**: Android's owner share-code card has a '공유 코드 재발급' OutlinedButton + a confirmation AlertDialog + a hint line, wired to regenerateFamilyShareCode() -> POST billing/vouchers/family-share/regenerate (invalidate leaked/maxed code, issue a new one). iOS's shareCodeCard only has '코드 복사' and '공유하기' — there is no regenerate button, no regenerate confirm dialog, no regenerateFamilyShareCode() in the view model, and no regenerate method in AlarmTalkAPI (only ensureFamilyShareCode). Owners on iOS cannot rotate a compromised/exhausted share code.
- **수정안**: Add `regenerateFamilyShareCode(session:)` to SocialFeatureViewModel calling a new `regenerateFamilyShareCode` API method (POST billing/vouchers/family-share/regenerate), and add the regenerate button + confirmation sheet + hint to MemberManagementView.shareCodeCard, mirroring MemberManagementScreen.kt:243-256/317-353.

### 🟡 Messages tab missing lock indicator; unread badge not suppressed when locked
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/app/AlarmTalkBottomBar.kt:152,173-187 ; ui/app/AlarmTalkApp.kt:464-465`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Root/BottomNavBar.swift:24-38 ; apps/ios-native/AlarmTalk/Views/Root/MainTabsView.swift:249-250`
- **차이**: Android passes `messagesLocked = !hasCoupleOrFamilyAccess(...)` to the bottom bar, which (a) renders a Lock icon overlay on the Messages tab for free/personal users and (b) suppresses the unread badge while locked (`if (!locked && badgeCount > 0)`). iOS BottomNavBar renders only a numeric unread badge with no lock-state input, so the Messages tab shows no lock affordance and would still show the unread count even when the feature is gated. (The plan-gate dialog on tap exists and is roughly equivalent, so functional access is gated; only the visual lock affordance + badge suppression are missing.)
- **수정안**: Thread a `locked` flag for the Messages tab into BottomNavBar (computed from hasCoupleOrFamilyAccess equivalent), draw a small Lock SF Symbol overlay on the tab when locked, and hide the numeric badge while locked, matching AlarmTalkBottomBar.kt:152/173-187.

### 🟡 Received note text is hidden behind audio playback; row tap only marks read for text notes
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/social/SocialPanels.kt:686,731-735`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Messages/VoiceMessagePanel.swift:653-654,670,704-707 ; apps/ios-native/AlarmTalk/SocialFeatureViewModel.swift:364-372`
- **차이**: Android NoteRow always renders `note.text` and marks the note read on any card tap (`Card(onClick = onMarkRead)`). iOS ReceivedNoteRow gates the text behind `shouldRevealText` — for a note with playable audio that hasn't been listened to, it shows the placeholder '음성을 들으면 메시지가 보여요.' instead of the text, and its `onTapGesture` only marks read when `!hasAudio` (so tapping an audio note's body does nothing; you must press play). This 'listen-to-reveal' behavior has no Android counterpart.
- **수정안**: Remove the reveal gating: always show `note.text` (drop shouldRevealText/revealedNoteIDs), and mark the note read on any row tap regardless of audio, matching SocialPanels.kt:686/731-735.

### ⚪ iOS shows a success status toast after every social refresh; Android shows none
- **분류**: error-handling
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/main/MainViewModelSocialActions.kt:20-57 ; ui/main/MainViewModelGrowthBillingActions.kt:237-260`
- **iOS**: `apps/ios-native/AlarmTalk/SocialFeatureViewModel.swift:176-177 ; apps/ios-native/AlarmTalk/Views/Messages/VoiceMessagePanel.swift:28-32`
- **차이**: Android's social/notes refresh sets `message` only on failure (snackbar). iOS refreshAll always sets `statusMessage = '소셜/이용권 정보를 불러왔어요.'` on success and VoiceMessagePanel renders statusMessage inline as a persistent footnote, so users see a status line on every successful refresh (and inline error text otherwise) that Android never shows.
- **수정안**: Only set statusMessage on failure in refreshAll (drop the success-message branch), and avoid rendering a persistent success status inside VoiceMessagePanel, matching Android's failure-only messaging.

### ⚪ Message composer shows all recipients; Android caps at 3
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/social/SocialPanels.kt:560`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Messages/VoiceMessagePanel.swift:195-201`
- **차이**: Android's composer recipient row renders `recipients.take(3)` FilterChips. iOS renders ForEach over all recipients in a horizontal ScrollView, so for a 4-member family the 4th recipient is selectable on iOS but hidden on Android.
- **수정안**: Cap the recipient chips to the first 3 recipients to match Android (or, if intentional, confirm and align both platforms).

### ⚪ Quiet-time dialog seeds a different default window when there are no existing windows
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/settings/SettingsScreenComponents.kt:255-261 ; network/AuthApi.kt:12-16 (FamilyAlarmQuietWindow default 09:00-18:30)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Settings/FamilyAlarmQuietTimeDialog.swift:69-75`
- **차이**: When initialWindows is empty, Android seeds one default window using FamilyAlarmQuietWindow() = days [1-5], 09:00-18:30. iOS seeds days [1-5], 22:00-07:00. (The '+ 시간 추가' button uses 22:00-07:00 on both, which matches; only the empty-seed default differs.) Rarely hit since the server default already provides a 09:00-18:30 window, but the seed values diverge.
- **수정안**: Seed the empty-state initial window with days [1-5], 09:00-18:30 to match Android's FamilyAlarmQuietWindow() default.

### ⚪ Member Management adds a 'leave group' button absent from Android's member screen
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/members/MemberManagementScreen.kt:55-365 (no leave action on this screen)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Members/MemberManagementView.swift:113-115,279-297`
- **차이**: iOS MemberManagementView renders a destructive '그룹 나가기' button for non-owner members directly on the member-management screen. Android's MemberManagementScreen has no leave action; on Android leaving is surfaced only via the FamilyConnectionPanel/CodeRegisterRow flow. iOS thus exposes leave in two places (also in CodeRegisterRow), deviating from Android's single-location placement.
- **수정안**: Remove the leave button from MemberManagementView (keep leave only in the CodeRegisterRow flow) to match Android's member screen, or confirm the duplicate placement is intended.

### ⚪ Voice-message panel header and empty-state structure differ from Android
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/social/SocialPanels.kt:455-505`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Messages/VoiceMessagePanel.swift:16-61`
- **차이**: Android VoiceMessagePanel header is a single row: '받은 메시지' title + a Refresh icon-button + a compose Button. When there are recipients but a free/no-plan state it shows a dedicated requires-plan card with '연결'/'이용권 보기' buttons, and the code-registration inputs live on a separate FamilyConnectionPanel. iOS uses a '가족 메시지' title + a text '새로고침' button, places '작성' as a separate prominent button, shows an EmptyStatePlaceholder when no recipients, and embeds CodeRegisterRow inline inside the messages panel. Structure, control types (icon vs text), and titles diverge.
- **수정안**: Align the header to a single row with title '받은 메시지', a Refresh icon-button, and an inline compose button; mirror Android's empty/locked states (requires-plan card vs inline code register) so the messages panel structure matches SocialPanels.kt:455-505.

---

## [holiday] Holiday & lunar engine — `minor-gaps`

The core engine is largely faithful: lunar→solar conversion and 대체공휴일 rules produce identical KASI dates for the tested range (2024-2031, both test suites assert the same golden vectors), the bundled seed (2026-2029) is byte-identical, the supported-country set [KR,JP,US,VN,CN] matches, and the /holiday contract (path, query params, type=="public" filter, response fields) is correctly mirrored. However iOS diverges in two real engine behaviors beyond the seed horizon — it flags the full 3-day 설날/추석 연휴 as holidays where Android intentionally flags only the single anchor day, and it buckets the alarm query date in fixed Asia/Seoul rather than the device zone Android uses — plus a cluster of UI/styling gaps in the upcoming list and the holiday-off toggle (missing section title, different date format, disabled-vs-hidden toggle, extra icon/affordances, divergent empty-state copy). None break the contract; most are pre-2030 invisible or cosmetic, so overall parity is minor-gaps.

### 🟡 iOS lunar engine marks the full 3-day 설날/추석 연휴 as holidays; Android marks only the single anchor day
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/data/LunarHolidayCalendar.kt:47-56`
- **iOS**: `apps/ios-native/AlarmTalk/KoreanLunarHolidayEngine.swift:140-154`
- **차이**: Android's on-device lunar engine (koreanLunarHolidays) returns ONLY the single anchor day for each lunar holiday (설날 음1/1, 추석 음8/15, 부처님 음4/8). Its membership test isKoreanLunarHoliday(date) therefore returns false for the surrounding 연휴 days; the design comment (LunarHolidayCalendar.kt:15-16) and the unit test (LunarHolidayCalendarTest.kt:122-123 assertFalse for 2026-02-16 and 2026-09-26) make this explicit — 연휴 days are intentionally delegated to the seed/server. iOS's computeSets instead inserts seollal-1/seollal/seollal+1 and chuseok-1/chuseok/chuseok+1 into the lunar set, so isLunarHoliday returns true for the whole 3-day block (iOS test asserts true for all of 2026-02-16..18). Within the seed range (2026-2029) this is invisible because the bundled seed already covers the 연휴 on both platforms, but for years beyond the seed horizon (2025, 2030+) iOS will skip alarms on the day before/after 설날·추석 while Android skips only the anchor day — a genuine difference in the skip-on-holiday output.
- **수정안**: Make the iOS engine's lunar set contain only the three anchor days (insert only seollal, chuseok, buddha — drop the ±1 neighbors) so out-of-seed-year membership matches Android, leaving 연휴 coverage to the seed/server exactly as Android does. Update LocalHolidayCalendarLunarTests accordingly.

### 🟡 Holiday-skip evaluates the alarm date in fixed Asia/Seoul on iOS vs device-local civil date on Android
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/data/AlarmTimeCalculator.kt:34-37`
- **iOS**: `apps/ios-native/AlarmTalk/HolidayStore.swift:245-254`
- **차이**: Android iterates candidate days as bare LocalDate in the scheduling zone (today.plusDays(offset)) and passes that device-local civil date straight into isHoliday; holiday matching is purely civil-date based and zone-independent. iOS's AlarmTimeCalculator (AlarmTimeCalculator.swift:57-59) passes a Date instant (now + offset days at the current time-of-day), and HolidayStore.isHoliday derives its epochDay via KoreanLunarHolidayEngine.epochDay (HolidayStore.swift:383-385 / KoreanLunarHolidayEngine.swift:72-77) and LocalHolidayCalendar.isKoreanFixedHoliday (HolidayStore.swift:157-167) using the FIXED Asia/Seoul calendar. On a non-KST device the instant buckets to a different civil day than the one AlarmTimeCalculator is actually scheduling (e.g. 09:00 in America/Los_Angeles → next day in Asia/Seoul), so the engine checks the wrong civil date and may ring on a holiday it should skip (or vice-versa). Note iOS even uses the device zone for the weekday selection check (isSelected, AlarmTimeCalculator.swift:84-88) but Asia/Seoul for the holiday check on the same date — internally inconsistent.
- **수정안**: Derive the query date's y/m/d in the scheduling/device timeZone (the same TimeZone AlarmTimeCalculator uses) and build the epochDay from those civil components, matching Android. Keep the seed/engine epochDay KEYS as zone-independent civil-date values; only the query-side conversion must use the device zone, not the hard-coded Asia/Seoul calendar.

### 🟡 Upcoming-holiday list is missing the '다가오는 공휴일' section title
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/HolidayUpcomingList.kt:43-48`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Editor/HolidayUpcomingList.swift:41-76`
- **차이**: Android always renders a section header Text using editor_holiday_show_title ("다가오는 공휴일" / "Upcoming holidays", style labelLarge, FontWeight.SemiBold, color onSurfaceVariant) above the rows — including in the empty/cold-cache state. The iOS HolidayUpcomingList renders no title at all (only rows or an empty-state line), and the surrounding editor (AlarmEditorSheet.swift:144-161) does not add one either, so the labeled section header is absent on iOS.
- **수정안**: Add a leading Text with the localized '다가오는 공휴일' string (theme.typography.labelLarge, semibold, onSurfaceVariant) at the top of HolidayUpcomingList, shown in all states (list, KR-empty, non-KR loading), to match Android's HolidayUpcomingList.

### 🟡 Upcoming-holiday row uses a different date format and fixed-width layout
- **분류**: styling-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/HolidayUpcomingList.kt:69-85`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Editor/HolidayUpcomingList.swift:60-87`
- **차이**: Android formats the date with DateTimeFormatter.ofPattern("M.d (E)") → compact numeric like "9.25 (금)", with the date Text at intrinsic width and a 12dp gap to the name. iOS uses setLocalizedDateFormatFromTemplate("EEEMMMd") which yields a localized abbreviated-month string (e.g. "9월 25일 (금)" / "Sep 25 (Fri)"), pins the date column to a fixed width: 96 with monospacedDigit, and uses theme.spacing.xs (8) between rows vs Android's 6dp. The visible date string and the row layout therefore differ.
- **수정안**: Format the date as Android does — month.day with weekday in parentheses (e.g. "M.d (E)" equivalent) — remove the fixed 96pt width and monospacedDigit so the date sizes intrinsically with a 12pt gap, and use 6pt vertical row spacing to match Android's Column spacedBy(6.dp).

### 🟡 Holiday-off toggle is shown disabled (dimmed) on iOS but hidden entirely on Android when no repeat day is selected
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/AlarmEditorControls.kt:123-165`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Editor/AlarmEditorSheet.swift:135-161`
- **차이**: Android's RepeatSelector wraps the entire holiday block in `if (holidayEnabled)` (repeatDaysMask != 0), so when no weekday is selected the holiday-off toggle, country label, and upcoming list are not rendered at all. iOS always renders HolidayOffToggle, merely dimming it to opacity 0.46 when mask==0 (HolidayOffToggle.swift:47). The disabled-but-visible toggle is a structural divergence from Android's hide-entirely behavior.
- **수정안**: Gate the whole holiday section in AlarmEditorSheet behind `draft.repeatDaysMask != 0` (render nothing when no repeat day is selected) instead of showing a dimmed HolidayOffToggle, matching Android's RepeatSelector.

### ⚪ Empty / cold-cache state copy differs from Android (extra KR message, different loading wording)
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/HolidayUpcomingList.kt:49-54`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Editor/HolidayUpcomingList.swift:43-58`
- **차이**: Android shows a single empty-state string, editor_holiday_cold_cache ("불러오는 중…" / "Loading…"), whenever the list is empty regardless of country. iOS branches into two distinct strings that Android does not have: non-KR shows "공휴일 정보를 불러오는 중…" (different wording from Android's "불러오는 중…") and KR shows "다가오는 공휴일이 없어요." (Android has no KR-specific 'none' message; it would show the same loading string).
- **수정안**: Use a single localized cold-cache string equal to editor_holiday_cold_cache ("불러오는 중…") for the empty state in both KR and non-KR branches, dropping the KR-only "다가오는 공휴일이 없어요." message, to match Android.

### ⚪ iOS holiday-off toggle adds a leading calendar icon that Android does not render
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/AlarmEditorControls.kt:124-146`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Editor/HolidayOffToggle.swift:26-30`
- **차이**: Android's holiday-off row is a Row of [Column(title + subtitle) , AlarmTalkSwitch] with no leading icon. iOS HolidayOffToggle renders a leading Image(systemName: "calendar.badge.exclamationmark") at 18pt semibold, primary color, in a 28pt frame before the title column. This is an extra visual element not present on Android.
- **수정안**: Remove the leading calendar Image from HolidayOffToggle (and its 28pt frame/spacing) so the row layout matches Android's icon-less title+subtitle+switch.

### ⚪ Holiday-off subtitle differs from Android for non-KR countries
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/res/values/strings.xml:226`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Editor/HolidayOffToggle.swift:16-22`
- **차이**: Android always uses the fixed subtitle editor_holiday_off_subtitle ("대체 공휴일 및 임시 공휴일 포함") under the holiday-off toggle regardless of selected country (AlarmEditorControls.kt:136-140). iOS keeps that string only for KR and substitutes "<국가명> 공휴일 기준" for other countries (driven by AlarmEditorSheet.swift:138-141 passing a country name). For JP/US/VN/CN the subtitle text diverges from Android.
- **수정안**: Always render the fixed '대체 공휴일 및 임시 공휴일 포함' subtitle (drop the subtitleCountryName branch) to match Android, or confirm the country-specific subtitle is an intentional product change for both platforms.

### ⚪ Country label has a different color and an extra '설정에서 변경' affordance vs Android
- **분류**: styling-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/AlarmEditorControls.kt:148-158`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Editor/AlarmEditorSheet.swift:144-160`
- **차이**: Android renders the holiday-calendar country label (editor_holiday_country_label = "공휴일 달력: %1$s" with flag+name) as a single bodySmall Text colored onSurfaceVariant, with no trailing element. iOS renders the same label colored onSurface (line 149) and appends a trailing "설정에서 변경" Text (onSurfaceVariant) pushed to the right by a Spacer — an extra affordance and a different color token for the primary label.
- **수정안**: Color the country label with onSurfaceVariant (not onSurface) and remove the trailing '설정에서 변경' text to match Android's single-line label, unless that affordance is intentionally added to both platforms.

### ⚪ Upcoming list window is bounded to 370 days on iOS but unbounded (LIMIT 5) on Android
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/data/HolidayEntity.kt:40-55`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Editor/HolidayUpcomingList.swift:31-39`
- **차이**: Android's getUpcoming query selects rows with epochDay >= today ORDER BY epochDay ASC LIMIT 5 with NO upper date bound, so it returns the next 5 cached holidays however far out they are. iOS computes holidaysIn(range: now...now+370days) then prefix(5), capping at a 370-day horizon. For KR this rarely matters (>5 holidays/year), but if fewer than 5 holidays fall within 370 days iOS would show fewer rows than Android.
- **수정안**: Drop the 370-day ceiling and instead take the first 5 cached entries with epochDay >= today sorted ascending (mirroring DAO getUpcoming), so the count/window semantics match Android.

### ⚪ Substitute-holiday generation is per-day on iOS vs block-as-unit on Android (latent divergence outside tested years)
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/data/KoreanHolidaySubstituteRules.kt:62-90`
- **iOS**: `apps/ios-native/AlarmTalk/KoreanLunarHolidayEngine.swift:235-330`
- **차이**: Android treats each 설날/추석 3-day block as a single unit: it emits at most one substitute per block (placed after block.last()), and among SET-B/solar holidays it applies the overlap-trigger ONLY to 어린이날 (childrensDayOverlapsOther). iOS instead enumerates every block day independently and applies the overlap trigger (hits>=2) to ALL candidate days. Outputs are identical for KASI 2024-2031 (both test suites pass), but the structures can diverge in untested configurations — e.g. a 설날/추석 block that contains both a Sunday and a separate day overlapping a fixed holiday would yield two substitutes on iOS but one on Android.
- **수정안**: Mirror Android's block-as-unit logic: trigger at most one substitute per 설날/추석 block (Sunday-in-block OR block-overlaps-other) placed after the block, and restrict the overlap trigger among solar holidays to 어린이날 only, so the algorithm stays 1:1 with KoreanHolidaySubstituteRules beyond the tested years.

---

## [editor-ui] Alarm editor UI & pickers — `minor-gaps`

iOS (AlarmEditorSheet + pickers) is a faithful port of Android's AlarmEditorScreen: the wire contract, new-alarm defaults (06:00, repeatMask 0, snooze on/5min/3x, vibration default, alarmVolume 100, voiceVolume 100, voiceRepeat true, randomPrompt true + preset context), validation, save/duplicate-conflict flow, voice/TTS generation, random-prompt contexts (7), language sets, free-tier 4-value lock, and stock-clip handling all match closely. However there are real gaps: a per-alarm listener-title (호칭) override field that exists on Android is entirely absent on iOS; the custom alarm-sound (ringtone) picker is missing; the snooze-interval control, vibration labels/toggle, and random-prompt settings are presented differently and with less content; and the time wheel and a few sliders deviate in sizing/granularity. Overall functional parity is good but with several medium UI/feature gaps and one high-impact missing control.

### 🟠 Per-alarm listener-title (호칭) override field is missing on iOS ✅(high, 실제 medium)
- **분류**: missing-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/VoiceAudioCard.kt:236; AlarmEditorScreen.kt:781`
- **iOS**: `apps/ios-native/AlarmTalk/VoiceStudioViewModel.swift:111; apps/ios-native/AlarmTalk/Views/Editor/AlarmEditorSheet+AlarmModeSection.swift:51 (no equivalent)`
- **차이**: Android shows an inline 'AlarmListenerTitleField' for every selected voice profile (own or shared) whenever profileOptions is non-empty. It lets the user override how the voice addresses them for THIS alarm via editor.voiceListenerTitleOverride, and the override is sent in the TTS request as listenerTitle ('editor.voiceListenerTitleOverride.trimmedOrNull() ?: resolveListenerTitle(...)'). On iOS the tts_profile branch has only the profile picker, prepared-voice chip, 'make in voice tab' button, stock picker, and random/manual editor — there is no per-alarm listener-title field. iOS 'selectedListenerTitle' (VoiceStudioViewModel.swift:111-119) only reads the profile's stored listenerTitle, so the generated voice always uses the profile default and the user can never customize the address term per alarm. iOS only collects a listener title in SharedVoiceSelectionSetupSheet, and only for shared voices that require viewer info.
- **수정안**: Add a listener-title override TextField (30-char cap, mirroring AlarmListenerTitleField) in the tts_profile branch of alarmModeSection after AlarmVoiceProfilePicker. Store it in editor state, invalidate prepared audio on change, and feed it into VoiceStudioViewModel.generateTTS so listenerTitle = override.nilIfBlank ?? selectedProfile.listenerTitle.

### 🟡 Custom alarm-sound (ringtone) picker + alarm-sound on/off toggle missing on iOS
- **분류**: missing-feature
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/AlarmEditorScreen.kt:1336 (AlarmSoundSettingsPane), :220 (ringtonePickerLauncher); AlarmSettingsCard.kt:149-168, 265-384`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Editor/AlarmEditorSheet.swift:207-227 (사운드 & 진동 section); apps/ios-native/AlarmTalk/Views/Editor/AlarmEditDraft.swift:293-294`
- **차이**: Android's 'Alarm sound' settings row opens a pane with a RingtoneManager picker that sets alarmSoundUri/alarmSoundLabel, a 'use alarm sound' on/off Switch (toggling sets alarmVolumePercent to 100 or 0), and a volume slider. iOS's '사운드 & 진동' section contains only AlarmVolumeSlider and the vibration picker — there is no ringtone selection and no explicit alarm-sound on/off toggle. AlarmEditDraft.toRecord only preserves existing alarmSoundUri/alarmSoundLabel (always nil for new alarms), so a custom alarm tone can never be chosen on iOS. (Partly a platform limitation: AlarmVolumeSlider.swift documents that AlarmKit owns the OS alarm tone; but at minimum the explicit on/off control and label surface are absent.)
- **수정안**: If AlarmKit allows a custom alert sound, add a sound picker that writes alarmSoundUri/alarmSoundLabel; otherwise add the explicit alarm-sound on/off control (drives alarmVolumePercent 100↔0) and surface the current sound label so the section structure matches Android.

### 🟡 Snooze-interval control: iOS Stepper(1–30) vs Android preset 5/10/15/30 + custom(1–60)
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/AlarmSnoozeSettings.kt:68 (SnoozeIntervals 5,10,15,30), :268-346 (radio list + custom 1–60 dialog)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Editor/AlarmEditorSheet.swift:185-196 (Stepper in 1...30); apps/ios-native/AlarmTalk/Views/Editor/AlarmEditDraft.swift:78,160`
- **차이**: Android offers snooze interval as preset radio options 5/10/15/30 plus a custom dialog accepting 1–60 minutes, presented in a full-screen pane. iOS uses an inline Stepper bounded to 1...30. Consequences: (a) iOS can select arbitrary values like 7 or 23 that Android's preset list does not surface; (b) iOS cannot select 31–60 that Android's custom dialog allows; (c) presentation differs (inline stepper vs preset radios + custom dialog). Note the backend caps snooze_minutes at 1–30 (packages/backend validateAlarmFields), so Android's 31–60 is itself out-of-contract. Default value (5) matches.
- **수정안**: Replace the Stepper with Android's preset options 5/10/15/30 plus a custom entry, capping custom input at 30 to stay within the backend contract (and optionally align Android down to 30).

### 🟡 Vibration pattern labels, 'none' handling, and on/off toggle differ
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/AlarmSettingsCard.kt:70-82 (VibrationOptions labels), :142-147 (on/off Switch); :394-395,458-472 (NONE excluded from list)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Editor/VibrationPatternPicker.swift:28 (Menu includes .none), :95-110 (Korean displayName)`
- **차이**: Android's VibrationOptions use English literal labels: 'Basic call', 'Strong', 'Short', 'Medium', 'Heartbeat', 'Ticktock', 'Waltz', 'Zig-zig-zig', 'Off-beat', 'Ripple', 'Siren'. iOS uses Korean labels ('기본','강함','짧게','보통','심장박동','똑딱똑딱','왈츠','지그재그','오프비트','물결','사이렌','없음'), so e.g. default reads 'Basic call' on Android vs '기본' on iOS and 'Zig-zig-zig' vs '지그재그'. Android also keeps NONE out of the pattern list and exposes vibration on/off via a separate Switch; iOS instead includes '없음' as a selectable menu item and has no on/off toggle.
- **수정안**: Align the per-pattern labels with Android's VibrationOptions strings, and reproduce Android's on/off Switch (default↔none) while removing '없음' from the menu list (or vice-versa), so the two surfaces match.

### 🟡 Random-prompt settings presented inline without per-context descriptions or modal save/cancel
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/AlarmRandomPromptSettings.kt:189-242 (context radios + language), :298-324 (per-context descriptions), :266-294 (weather/fortune dialogs)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Editor/AlarmEditorSheet+AlarmModeSection.swift:134-198`
- **차이**: Android presents random-prompt configuration as a dedicated full-screen pane (RandomPromptSettingsPane) reached by toggling '랜덤 문구 사용': it has an intro card, a 7-item context radio list, a distinct description for each context (RandomPromptContextDescription), weather/fortune detail rows, a language radio, and a Save button; choosing a weather/fortune context auto-opens a dialog to capture required info, and cancelling reverts the toggle. iOS configures the same data inline in the alarm-mode section with a context Picker(menu), a language Picker(menu), inline WeatherLocationInputFields/FortunePromptInputFields, and only a single generic line ('선택한 상황에 맞춰 깨움말을 자동으로 만들어요.') — there are no per-context descriptions, no intro card, and no modal save/cancel semantics. The 7 contexts, labels, usesWeather (wake_weather/meal/exercise) and language sets do match.
- **수정안**: Add the per-context description text Android shows for each RandomPromptContext, and (optionally) align the flow to the modal save/cancel pattern; at minimum surface the context-specific guidance copy so users get the same explanation per context.

### ⚪ Time wheel uses smaller fixed sizes and no Dynamic-Type scaling
- **분류**: styling-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/AlarmTimePicker.kt:56-57 (72.dp × fontScale up to 1.5); DraggableTimeWheelColumn.kt:149-153 (displayLarge/displayMedium); AmPmWheelColumn.kt:99,164-171 (96.dp width, 38/32sp, unselected alpha 0.18)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Editor/TimeWheelPicker.swift:24 (itemHeight 60 fixed), :132 (numbers 48pt), :30,291-292 (AM/PM width 92, 36/30pt, unselected opacity 0.22)`
- **차이**: Both are 12h wheels (AM/PM + hour 1–12 + minute, wrapping) and share the 34-radius primaryContainer background, so behavior matches. But the sizing differs: Android row height is 72.dp and scales with the system font scale up to 1.5×, selected numbers use typography.displayLarge (~57sp) and neighbors displayMedium, AM/PM is 38/32sp in a 96.dp column with column spacing 16.dp. iOS uses a fixed 60pt row height (no Dynamic-Type scaling of wheel rows), fixed 48pt numbers, AM/PM 36/30pt in a 92pt column with 14 spacing, and AM/PM unselected opacity 0.22 vs Android's 0.18.
- **수정안**: Match item height (72), number font sizes, AM/PM sizes/column width and spacing to Android, scale the wheel rows with Dynamic Type (≤1.5×), and set the AM/PM unselected opacity to 0.18.

### ⚪ Label field placed in its own section before repeat, and blank-label default differs
- **분류**: ui-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/AlarmEditorControls.kt:73-82 (label below RepeatSelector, with floating label + placeholder); AlarmRepository.kt:128,207 (blank → R.string.rd_default_alarm_label)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Editor/AlarmEditorSheet.swift:119-124,126 (label Section above 반복 section); apps/ios-native/AlarmTalk/Views/Editor/AlarmEditDraft.swift:243 (blank → "알람")`
- **차이**: On Android the alarm-name field lives inside the schedule card immediately AFTER the repeat selector and uses both a floating label (editor_label_alarm_name) and a placeholder (editor_placeholder_alarm_name). On iOS the label is its own Form section placed BEFORE the 반복 section and shows only the placeholder '알람 이름'. Additionally, a blank label is defaulted to the localized rd_default_alarm_label on Android but to a hard-coded "알람" on iOS, so the persisted default text may diverge if that resource isn't literally '알람'.
- **수정안**: Move the label field below the repeat selector to match Android's ordering, add a field label in addition to the placeholder, and confirm the blank-label default string matches Android's rd_default_alarm_label.

### ⚪ Alarm volume slider granularity differs (Android snaps to deciles, iOS continuous)
- **분류**: logic-diff
- **Android**: `apps/android-native/app/src/main/java/com/alarmtalk/app/ui/editor/AlarmSettingsCard.kt:372-378 (Slider 0..100, steps=9 → 11 stops at 0,10,…,100)`
- **iOS**: `apps/ios-native/AlarmTalk/Views/Editor/AlarmVolumeSlider.swift:32-37 (Slider 0...100, step 1)`
- **차이**: Android's alarm-volume slider uses steps=9 over 0..100, snapping to 0/10/20/…/100 (11 discrete stops). iOS's AlarmVolumeSlider uses step 1, allowing any integer 0–100. The two produce different selectable values for the same control. (The voice-volume sliders, by contrast, match: both snap to 30/40/…/100.)
- **수정안**: Set the iOS AlarmVolumeSlider step to 10 (range 0...100) so it snaps to the same deciles as Android.

---
