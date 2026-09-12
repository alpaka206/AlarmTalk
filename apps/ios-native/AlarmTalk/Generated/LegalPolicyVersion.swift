// 이 파일은 scripts/generate-legal-version.sh 가 만든다. 직접 고치지 말 것.
// 출처: docs/legal/privacy-policy.ko.md · docs/legal/terms-of-service.ko.md 의 '정책 버전' 머리말.
enum LegalPolicy {
    /// 이 빌드가 번들에 담고 있는 법무 문서의 버전. `POST /user/consents` 의
    /// `document_version` 으로 보낸다. 서버의 CURRENT_POLICY_VERSION 과 다르면
    /// 409 POLICY_VERSION_MISMATCH 로 거부된다.
    static let bundledVersion = "5"
}
