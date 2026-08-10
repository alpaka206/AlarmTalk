import SwiftUI

/// **폼 모달의 공용 껍데기** — 화면 가운데 뜨는 카드다.
///
/// ⚠ **바텀시트로 만들지 말 것.** 안드로이드는 목록형만 바텀시트(`WakerSelectionSheet`)이고,
/// 입력이 여러 개인 폼(운세 정보·설정 불가 시간 등)은 **가운데 뜨는 카드 다이얼로그**다
/// (`ui/components/ModalDialogTitle.kt` + Dialog). iOS 는 전부 `.sheet` 로 아래에서 올려서,
/// 같은 화면이 두 앱에서 다르게 보였다(2026-08-10 지적 "저렇게 모든 모달 아래에서 위로
/// 올리는 걸로 할 거야?" — 안드로이드는 그렇지 않다).
///
/// 안드로이드 `ModalDialogTitle` 스펙 그대로:
/// - 제목 `titleLarge`(22, Bold) + 우측 X(터치 48, 아이콘 20)
/// - 카드 모서리 `WakerCardShape`(22), 내용 패딩 20
/// - 스크림을 탭하면 닫힌다(안드로이드 Dialog 기본 동작과 같다)
///
/// 쓰는 법: `.formDialog(isPresented:title:onDismiss:) { 내용 }`
struct FormDialog<Content: View>: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let title: String
    let onDismiss: () -> Void
    @ViewBuilder var content: () -> Content

    var body: some View {
        ZStack {
            // 스크림 — 탭하면 닫힌다.
            AlarmTalkTheme.scrim
                .ignoresSafeArea()
                .onTapGesture(perform: onDismiss)

            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .center, spacing: 12) {
                    Text(title)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(theme.palette.onSurface)
                        .lineLimit(2)
                    Spacer(minLength: 0)
                    Button(action: onDismiss) {
                        Image(systemName: "xmark")
                            .font(.system(size: 20, weight: .medium))
                            .foregroundStyle(theme.palette.onSurfaceVariant)
                            // 안드로이드 `IconButton` 과 같은 48 터치 타깃.
                            .frame(width: 48, height: 48)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("닫기"))
                }

                content()
            }
            .padding(20)
            .frame(maxWidth: 480)
            .background(
                theme.palette.surface,
                in: RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous)
            )
            .padding(.horizontal, 20)
            // 키보드가 올라와도 카드가 가려지지 않게 한다.
            .padding(.bottom, 0)
        }
        // 카드를 탭했을 때 스크림 탭으로 새지 않게 막는다.
        .contentShape(Rectangle())
    }
}

extension View {
    /// 화면 가운데 뜨는 폼 다이얼로그를 얹는다. `.sheet` 가 아니라 `.fullScreenCover` 를
    /// 쓰는 이유: 아래에서 올라오는 시트 모션을 피하고 배경을 우리가 칠하기 위해서다.
    func formDialog<Content: View>(
        isPresented: Binding<Bool>,
        title: String,
        onDismiss: @escaping () -> Void,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        fullScreenCover(isPresented: isPresented) {
            FormDialog(title: title, onDismiss: onDismiss, content: content)
                // 시스템 배경을 지워 스크림만 보이게 한다(가운데 카드 문법).
                .presentationBackground(.clear)
        }
    }
}
