import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

/// 목소리 클립을 받는 동안 **잠금화면·다이나믹 아일랜드에 진행률**을 띄우는 Live Activity.
///
/// ⚠ **iOS 에는 갱신되는 진행률 알림이 없다.** 안드로이드는 포그라운드 서비스 알림에
/// 퍼센트를 계속 갱신하지만, iOS 알림은 한 번 뜨면 내용을 바꾸는 용도가 아니다.
/// 진행을 계속 보여 주는 iOS 의 정식 수단이 Live Activity 라 같은 뜻을 이걸로 낸다
/// (docs/spec/voice-and-message.md 「미리 받아 둔다」 절).
///
/// 앱 타깃과 위젯 확장이 **같은 타입을 공유해야** 하므로 이 파일은 두 타깃에 함께 들어간다.
#if canImport(ActivityKit)
struct ClipPrefetchActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        /// 0~100. `ClipReadiness.percent` 와 같은 값 — **99.6% 를 100% 로 보여 주지 않는다.**
        var percent: Int
        /// 지금 무엇을 기다리는지. 퍼센트만 있으면 서버 렌더 구간에서 멈춘 것처럼 보인다.
        var detail: String
    }

    /// 표시 제목(고정).
    var title: String
}
#endif
