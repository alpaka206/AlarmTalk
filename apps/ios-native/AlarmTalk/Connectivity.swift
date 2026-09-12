import Foundation
import Network

/// 인터넷 연결 여부를 관찰 가능한 상태로 노출한다.
///
/// 안드로이드 `ui/util/Connectivity.kt` 의 `rememberIsOnline` 짝이다. 연결이 바뀌면 뷰가
/// 다시 그려지므로 "오프라인이라 못 불러왔어요" 같은 안내가 **복구 즉시 사라진다.**
///
/// ⚠ **이게 없어서 iOS 는 오프라인과 로딩을 구별하지 못했다**(2026-08-18). 무료 테마 요약
/// 행(`FreeThemeSummaryRow`)은 주석에 "오프라인이면 '준비 중' 이라고 속이지 않는다" 고
/// 적어 놓고도 **언제나 "불러오는 중이에요"** 를 돌려줬다 — 비행기모드에서 영원히 그
/// 문구에 머문다. 안드로이드는 두 문구를 나눠 갖고 있었다
/// (`editor_free_bucket_loading` / `editor_free_bucket_offline`).
///
/// 기본값을 **연결됨**으로 두는 것은 안드로이드와 같다. 아직 첫 경로 보고를 못 받았을 때
/// '오프라인' 이라고 단정하면, 멀쩡한 기기에서 앱을 켤 때마다 오프라인 안내가 한 번씩
/// 깜빡인다.
@MainActor
final class NetworkMonitor: ObservableObject {
    static let shared = NetworkMonitor()

    @Published private(set) var isOnline = true

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.alarmtalk.network-monitor")

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in
                guard let self, self.isOnline != online else { return }
                self.isOnline = online
            }
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }
}
