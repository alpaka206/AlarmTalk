import Foundation

/// `AppVersionGate` 가 의존하는 API 시그니처. 단위 테스트에서 mock 주입용.
protocol AppVersionProviding: Sendable {
    func appVersion(platform: String) async throws -> AppVersionResponse
}

extension AlarmTalkAPI: AppVersionProviding {}

/// 백엔드 최소지원버전 게이팅. 설치 버전이 `min_supported_version` 미만이면
/// `updateRequired=true` 로 두어 RootView 가 업데이트 차단 화면을 띄운다.
/// 로그인 여부와 무관하게 동작하며, 네트워크 실패 시에는 앱 사용을 막지 않는다.
/// Android `MainViewModel.checkAppVersion()` + `updateRequired`/`updateStoreUrl` 와 동등.
@MainActor
final class AppVersionGate: ObservableObject {
    @Published private(set) var updateRequired = false
    @Published private(set) var storeURLString = ""

    private let api: AppVersionProviding
    /// 설치된 앱의 빌드 번호(CFBundleVersion). Android `appVersionCode` 대응.
    let appVersionCode: Int

    init(
        api: AppVersionProviding = AlarmTalkAPI.shared,
        appVersionCode: Int = AppVersionGate.installedVersionCode()
    ) {
        self.api = api
        self.appVersionCode = appVersionCode
    }

    /// 앱 시작 시 1회 호출. 백엔드 정책을 조회해 강제 업데이트 여부를 판단한다.
    func checkAppVersion() async {
        do {
            let policy = try await api.appVersion(platform: "ios")
            storeURLString = policy.storeUrl
            // Android: appVersionCode in 1 until minSupportedVersion
            updateRequired = appVersionCode >= 1 && appVersionCode < policy.minSupportedVersion
        } catch {
            // 정책 조회 실패 시 앱 사용을 막지 않는다.
            updateRequired = false
        }
    }

    /// 업데이트 버튼이 열 App Store URL. 백엔드 store_url 우선, 비어 있으면 App Store 앱 진입.
    var storeURL: URL {
        let trimmed = storeURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty, let url = URL(string: trimmed) {
            return url
        }
        return URL(string: "https://apps.apple.com")!
    }

    static func installedVersionCode() -> Int {
        let raw = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "1"
        return Int(raw) ?? 1
    }
}
