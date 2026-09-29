import SwiftUI
import UIKit

/// 앱 진입을 막는 전체 화면의 골격 — 아이콘 · 제목 · (선택) 한 줄 · 본문 · 버튼.
///
/// 강제 업데이트(`UpdateRequiredView`), 탈퇴 유예(`AccountPendingDeletionView`),
/// 기본 목소리 교체(`StockReplacementView`)가 함께 쓴다. 화면마다 다른 것은 아이콘·문구·
/// 버튼뿐이다.
struct BlockingScreen<Detail: View, Actions: View>: View {
    let systemImage: String
    let tint: Color
    let title: LocalizedStringKey
    let message: LocalizedStringKey
    /// 제목과 본문 사이에 끼우는 한 줄(교체 화면의 퍼센트). 없으면 아무것도 그리지 않는다.
    @ViewBuilder var detail: () -> Detail
    @ViewBuilder var actions: () -> Actions

    /// ⚠ **ScrollView 를 빼지 말 것.** 이 화면들의 탈출구는 아래 버튼뿐이라, 큰
    /// 글꼴(손쉬운 사용의 더 큰 텍스트)에서 내용이 화면을 넘치면 버튼이 밖으로 나가
    /// **누를 방법이 사라진다** — 탈퇴를 되돌리려던 사용자가 30일 뒤 계정·알람·목소리를
    /// 잃고, 강제 업데이트·교체 화면에서는 앱이 벽돌이 된다.
    /// 안드로이드도 같은 이유로 `verticalScroll` 을 둔다.
    /// ScrollView 안의 VStack 이 화면을 가득 채우도록. 내용이 짧으면 가운데 정렬을
    /// 유지하고, 넘치면 스크롤된다.
    private var scrollMinHeight: CGFloat {
        UIScreen.main.bounds.height * 0.7
    }

    var body: some View {
        ScrollView {
          VStack(spacing: 0) {
            Spacer()

            Image(systemName: systemImage)
                .font(.system(size: 56, weight: .regular))
                .frame(width: 72, height: 72)
                .foregroundStyle(tint)

            Spacer().frame(height: 24)

            Text(title)
                .font(.title2.weight(.bold))
                .foregroundStyle(AlarmTalkTheme.text)
                .multilineTextAlignment(.center)

            detail()

            Spacer().frame(height: 12)

            Text(message)
                .font(.body)
                .foregroundStyle(AlarmTalkTheme.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            Spacer().frame(height: 32)

            actions()

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

extension BlockingScreen where Detail == EmptyView {
    init(
        systemImage: String,
        tint: Color,
        title: LocalizedStringKey,
        message: LocalizedStringKey,
        @ViewBuilder actions: @escaping () -> Actions
    ) {
        self.init(
            systemImage: systemImage,
            tint: tint,
            title: title,
            message: message,
            detail: { EmptyView() },
            actions: actions
        )
    }
}
