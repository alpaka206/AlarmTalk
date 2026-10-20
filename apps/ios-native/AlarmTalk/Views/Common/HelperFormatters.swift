import Foundation
import SwiftUI

/// 화면 분해 과정에서 떠다니던 작은 format/label 헬퍼를 한 곳으로 모았다.
///
/// 모두 순수 함수라 어디서든 호출할 수 있고, 분리된 화면 파일들이
/// 동일한 표기 규칙(오디오 길이 표기)을 공유한다.
enum HelperFormatters {
    /// 밀리초를 "분:초"(m:ss) 로 표기. 오디오 크롭/길이 표시에 공용으로 쓴다.
    /// Android `audioTimeLabel` 대응. (여러 뷰에 흩어져 있던 동일 구현을 통합.)
    static func audioTimeLabel(_ millis: Int) -> String {
        let seconds = max(0, millis / 1000)
        return String(format: "%d:%02d", seconds / 60, seconds % 60)
    }
}
