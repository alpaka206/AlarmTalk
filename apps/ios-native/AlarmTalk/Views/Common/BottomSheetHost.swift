import SwiftUI
import UIKit

/// **화면 폭을 꽉 채우는 바텀시트** — 안드로이드 `ModalBottomSheet` 와 같은 모양이다.
///
/// ⚠ **시스템 `.sheet` 로 되돌리지 말 것.** iOS 26 의 기본 시트는 화면 가장자리에서 안쪽으로
/// 들어가 뜨고 **아래 모서리까지 둥글다**(떠 있는 카드). 안드로이드 바텀시트는 좌우를 꽉
/// 채우고 위 모서리만 둥글다 — 같은 화면이 두 앱에서 다르게 보인다
/// (2026-08-10 지적 "좌우에 여백이 있는데 여백 없는 게 맞지 않나").
/// `.presentationSizing(.page)` 로도 없어지지 않는다(시뮬레이터에서 확인) — iOS 26 시트의
/// 표현 자체라 끄는 공개 API 가 없다. 그래서 직접 그린다.
///
/// 규칙(안드로이드 `WakerSelectionSheet` 와 같다):
/// - 좌우 여백 0, **위 모서리만** 둥글다(`WakerSheetShape`).
/// - 위에 드래그 핸들(36×4, `onSurfaceVariant` 38%).
/// - 스크림 탭 또는 아래로 끌어 닫는다.
/// - 높이는 **내용만큼**. 화면의 50% 를 넘으면 그 안에서 스크롤한다.
struct BottomSheetHost<Content: View>: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let onDismiss: () -> Void
    /// 화면의 몇 %까지 차지할 수 있는가. 넘으면 안에서 스크롤한다.
    var maxFraction: CGFloat = 0.5
    @ViewBuilder var content: () -> Content

    @State private var dragOffset: CGFloat = 0
    @State private var appeared = false
    /// 내용이 보고한 자연 높이(`measuredSheetContent`). 이걸로 시트 높이를 잡는다.
    @State private var contentHeight: CGFloat = 0
    /// 스크롤 밖 머리말(제목) 높이 — 빼먹으면 마지막 행이 잘린다.
    @State private var headerHeight: CGFloat = 0

    /// 드래그 핸들 영역(12 + 4 + 10).
    private let handleHeight: CGFloat = 26

    var body: some View {
        ZStack(alignment: .bottom) {
            AlarmTalkTheme.scrim
                .ignoresSafeArea()
                .opacity(appeared ? 1 : 0)
                .onTapGesture { close() }

            VStack(spacing: 0) {
                handle
                content()
            }
            .onPreferenceChange(SheetContentHeightKey.self) { contentHeight = $0 }
            .onPreferenceChange(SheetHeaderHeightKey.self) { headerHeight = $0 }
            // ⚠ **높이를 열어 두면 화면을 꽉 채운다.** 안의 `ScrollView` 가 주는 만큼
            // 늘어나기 때문이다 — 내용이 보고한 자연 높이로 잡고 화면 50% 에서 자른다.
            .frame(maxWidth: .infinity)
            .frame(height: resolvedHeight)
            .background(theme.palette.surface)
            // ⚠ **위 모서리만** 둥글다 — 아래까지 둥글리면 iOS 기본 시트처럼 떠 보인다.
            .clipShape(TopRoundedRectangle(radius: theme.shapes.extraLarge))
            .offset(y: max(dragOffset, 0) + (appeared ? 0 : 600))
            .gesture(
                DragGesture()
                    .onChanged { dragOffset = $0.translation.height }
                    .onEnded { value in
                        // 충분히 내렸거나 아래로 튕기면 닫는다.
                        if value.translation.height > 120 || value.predictedEndTranslation.height > 240 {
                            close()
                        } else {
                            withAnimation(.snappy(duration: 0.2)) { dragOffset = 0 }
                        }
                    }
            )
            .ignoresSafeArea(edges: .bottom)
        }
        .onAppear {
            if reduceMotion { appeared = true }
            else { withAnimation(.snappy(duration: 0.28)) { appeared = true } }
        }
    }

    /// 내용만큼, 단 화면 50% 까지.
    private var resolvedHeight: CGFloat? {
        guard contentHeight > 0 else { return nil }
        let safeBottom = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow?.safeAreaInsets.bottom }
            .first ?? 0
        let wanted = contentHeight + headerHeight + handleHeight + safeBottom
        // ⚠ 상한은 **화면의 50%** 다(2026-08-10 요청) — 그보다 길어지면 시트를 더 키우지
        // 않고 **안에서 스크롤**한다. 목록이 길다고 화면을 덮으면 뒤 화면이 안 보인다.
        return min(wanted, UIScreen.main.bounds.height * maxFraction)
    }

    private var handle: some View {
        // 안드로이드 `WakerSheetDragHandle`: 36×4, 위 12 · 아래 10.
        Capsule()
            .fill(theme.palette.onSurfaceVariant.opacity(0.38))
            .frame(width: 36, height: 4)
            .padding(.top, 12)
            .padding(.bottom, 10)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
    }

    private func close() {
        if reduceMotion {
            onDismiss()
            return
        }
        withAnimation(.snappy(duration: 0.22)) {
            appeared = false
            dragOffset = 600
        }
        // 애니메이션이 끝난 뒤 실제로 없앤다.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) { onDismiss() }
    }
}

/// 위 두 모서리만 둥근 사각형.
struct TopRoundedRectangle: Shape {
    let radius: CGFloat

    func path(in rect: CGRect) -> Path {
        Path(
            UIBezierPath(
                roundedRect: rect,
                byRoundingCorners: [.topLeft, .topRight],
                cornerRadii: CGSize(width: radius, height: radius)
            ).cgPath
        )
    }
}

extension View {
    /// 화면 폭을 꽉 채우는 바텀시트를 얹는다. 자세한 이유는 `BottomSheetHost` 주석 참조.
    ///
    /// ⚠ `.sheet` 가 아니라 `.fullScreenCover` 위에 직접 그린다 — 시스템 시트의 들여쓴
    /// 표현을 피하고 배경·모서리를 우리가 정하기 위해서다.
    func bottomSheet<Content: View>(
        isPresented: Binding<Bool>,
        onDismiss: @escaping () -> Void,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        fullScreenCover(isPresented: isPresented) {
            BottomSheetHost(onDismiss: onDismiss, content: content)
                .presentationBackground(.clear)
        }
    }
}
