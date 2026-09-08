import SwiftUI
import UIKit

/// **기본 목소리 교체가 아직 안 끝났을 때** 앱 진입을 막는 화면(2026-09-03 지시).
///
/// 교체 회차에는 순서가 있다 — **다 받고 → 다 묶고 → 그 다음에 지운다.** 중간 상태로 앱을
/// 쓰면 알람이 **이름은 새 이름인데 소리는 옛 목소리**로 울 수 있어서, 남은 것이 있으면
/// 막고 다시 시도하게 한다. 삭제 실패는 막지 않는다 — 그때는 교체가 이미 끝나 있다.
///
/// 판정과 기본값은 `StockReplacementStatus` 주석 참조 — **기본값은 막지 않는 쪽**이다.
/// Android `ui/app/StockReplacementScreen.kt` 의 1:1 포팅.
struct StockReplacementView: View {
    let working: Bool
    let onRetry: () -> Void

    /// ⚠ **ScrollView 를 빼지 말 것.** 이 화면의 탈출구는 아래 버튼 하나뿐이라, 큰 글꼴에서
    /// 내용이 화면을 넘치면 버튼이 밖으로 나가 **누를 방법이 사라진다** — 앱이 벽돌이 된다.
    /// 안드로이드도 같은 이유로 `verticalScroll` 을 둔다.
    private var scrollMinHeight: CGFloat {
        UIScreen.main.bounds.height * 0.7
    }

    var body: some View {
        ScrollView {
          VStack(spacing: 0) {
            Spacer()

            Image(systemName: "arrow.down.circle")
                .font(.system(size: 56, weight: .regular))
                .frame(width: 72, height: 72)
                .foregroundStyle(AlarmTalkTheme.primary)

            Spacer().frame(height: 24)

            Text("목소리를 새로 받고 있어요")
                .font(.title2.weight(.bold))
                .foregroundStyle(AlarmTalkTheme.text)
                .multilineTextAlignment(.center)

            Spacer().frame(height: 12)

            Text("기본 목소리가 바뀌어서 알람에 쓸 음성을 다시 받는 중이에요. 다 받아야 알람이 새 목소리로 울려요.\n\n네트워크가 불안정하면 멈출 수 있어요. 그럴 때는 아래 버튼을 눌러 주세요.")
                .font(.body)
                .foregroundStyle(AlarmTalkTheme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            Spacer().frame(height: 32)

            Button(action: onRetry) {
                HStack(spacing: 10) {
                    if working {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(.white)
                    }
                    Text(working ? "받는 중…" : "다시 시도")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity, minHeight: 50)
            }
            .buttonStyle(.borderedProminent)
            .tint(AlarmTalkTheme.primary)
            .disabled(working)

            Spacer()
          }
          .padding(.horizontal, 32)
          // 내용이 짧을 때도 Spacer 가 위아래로 벌어지도록 최소 높이를 준다.
          .frame(maxWidth: .infinity, minHeight: scrollMinHeight)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AlarmTalkTheme.background)
    }
}

#if DEBUG
#Preview("StockReplacement (idle)") {
    StockReplacementView(working: false, onRetry: {})
        .voiceAlarmPreviewEnvironment()
}

#Preview("StockReplacement (working)") {
    StockReplacementView(working: true, onRetry: {})
        .voiceAlarmPreviewEnvironment()
}
#endif
