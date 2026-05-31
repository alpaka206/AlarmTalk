# Legal / Privacy Release Pack

This folder contains release-review documents for AlarmTalk's legal and privacy surfaces.
They are written for Korean launch first, with Android first and iOS later.

These documents are not a substitute for review by counsel. Before public release,
confirm that the public developer name, operator contact, business registration,
payment details, and processor list match the final production setup.

## Where These Must Appear

- Public website footer: `/ko/privacy`, `/ko/terms`
- Google Play Console: privacy policy URL and Data safety form
- App Store Connect: privacy policy URL and App Privacy details
- In-app onboarding: required consent to Terms and Privacy Policy
- In-app voice registration: separate voice/AI processing consent before recording,
  upload, speaker separation, voice cloning, or TTS generation
- In-app Settings: Privacy Policy, Terms, consent withdrawal, account deletion,
  support contact
- Account deletion screen: clear deletion scope and retention exceptions
- App review notes: explain voice cloning, family sharing, and local alarm behavior

## Files

- `privacy-policy.ko.md`: public 개인정보 처리방침 draft
- `terms-of-service.ko.md`: public 서비스 이용약관 draft
- `consent-and-permission-copy.ko.md`: in-app consent and permission copy
- `store-disclosures.ko.md`: Google Play / App Store disclosure checklist

## Release Blockers

- Confirm the final public brand: `AlarmTalk` (Korean: `알람톡`).
- Confirm operator entity, representative, address, business registration number,
  mail-order business registration if paid plans are sold directly.
- Confirm support/privacy email domains are live.
- Confirm third-party processors and countries:
  Cloudflare, Turso/libSQL, ElevenLabs, Sentry, Google, Apple, email providers,
  payment providers.
- Confirm whether voice data is treated as biometric information under the final
  product flow and jurisdiction review. These drafts conservatively treat user
  voice recordings and cloned voice profiles as highly sensitive voice data that
  requires separate explicit consent.
- Confirm account deletion deletes or anonymizes server data and R2 voice objects
  according to the retention table.
- Confirm Google Play Data safety and App Store privacy labels exactly match the
  production SDKs and backend behavior.

## Source Notes

- 개인정보보호위원회 published the current 2025.4 privacy policy writing guideline for
  transparent privacy policies under Korean privacy law.
- Google Play requires a privacy policy and accurate Data safety disclosure, plus
  prominent in-app disclosure/consent where required for personal and sensitive
  user data.
- Apple requires a privacy policy link in App Store Connect metadata and within
  the app, and App Privacy responses must stay accurate and current.
