import SwiftUI

/// 편집기 섹션 제목 — 카드 **밖** 위쪽. 안드로이드 `EditorSectionTitle`.
struct EditorSectionTitle: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let text: String

    var body: some View {
        Text(text)
            .font(theme.typography.titleSmall)
            .fontWeight(.bold)
            .foregroundStyle(theme.palette.onSurface)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// 편집기 카드 표면 — `WakerCardShape`(22) + surface + outlineVariant 1pt.
///
/// ⚠ **iOS 기본 `Form`/`Section` 으로 돌아가지 말 것.** `Form` 은 iOS 표준 그룹 목록
/// 모양을 강제해(회색 배경 위 흰 그룹, 자체 여백·구분선) 안드로이드의 Waker 카드와
/// 나란히 놓으면 다른 앱이 된다. 편집기는 카드 목록이지 설정 폼이 아니다.
struct EditorCard<Content: View>: View {
    @Environment(\.voiceAlarmTheme) private var theme
    var horizontalPadding: CGFloat = 16
    var verticalPadding: CGFloat = 4
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content()
        }
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, verticalPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            theme.palette.surface,
            in: RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous)
                .stroke(theme.palette.outlineVariant, lineWidth: 1)
        )
    }
}

/// 세부 설정 카드의 한 행 — 제목 + 요약 부제 + (선택) 스위치. 탭하면 상세 pane 으로.
///
/// 안드로이드 `AlarmSettingRow`. **요약이 핵심이다** — 값을 보려고 매번 열어 볼 필요가
/// 없어야 카드 하나로 네 가지 설정이 한눈에 읽힌다.
struct AlarmSettingRow<Trailing: View>: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let title: String
    let subtitle: String
    var showsChevron: Bool = true
    let onTap: () -> Void
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onTap) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(theme.typography.bodyLarge)
                        .fontWeight(.semibold)
                        .foregroundStyle(theme.palette.onSurface)
                    Text(subtitle)
                        .font(theme.typography.bodySmall)
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            trailing()

            if showsChevron {
                Button(action: onTap) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(theme.palette.onSurfaceVariant)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 12)
        .frame(minHeight: 56)
    }
}

extension AlarmSettingRow where Trailing == EmptyView {
    init(title: String, subtitle: String, showsChevron: Bool = true, onTap: @escaping () -> Void) {
        self.init(title: title, subtitle: subtitle, showsChevron: showsChevron, onTap: onTap, trailing: { EmptyView() })
    }
}

/// 세부 설정 카드 행 사이 구분선. 카드 좌우 패딩 안쪽으로만 긋는다.
struct AlarmSettingDivider: View {
    @Environment(\.voiceAlarmTheme) private var theme

    var body: some View {
        Rectangle()
            .fill(theme.palette.outlineVariant)
            .frame(height: 1)
    }
}

/// 편집기 하단 **고정** 액션 바 — [취소] [저장].
///
/// ⚠ **스크롤에 딸려 보내지 말 것.** 저장 버튼이 본문 맨 아래에 있으면, 설정을 다 만진
/// 뒤 저장하려고 다시 끝까지 스크롤해야 한다. 안드로이드는 상단바를 없애고 취소·저장을
/// 하단에 고정했다(`AlarmEditorScreen.kt:1269-1271` 주석).
///
/// ⚠ **저장 중에는 취소도 함께 잠근다.** 저장만 잠그면 사용자가 X 를 눌러 취소한 줄
/// 아는데 몇 초 뒤 알람이 저장·예약되고 탭이 튄다.
struct EditorActionBar: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let saveTitle: String
    let saving: Bool
    let savingLabel: String
    let saveEnabled: Bool
    let onCancel: () -> Void
    let onSave: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            // ⚠ 프레임을 **label 안에** 준다. `.buttonStyle` 뒤에 붙이면 버튼 자체는
            // 내용 크기로 잡히고 바깥 프레임만 넓어져, 두 버튼이 5:5 로 안 나뉜다.
            Button(action: onCancel) {
                Text("취소").frame(maxWidth: .infinity, minHeight: 52)
            }
            .font(theme.typography.titleMedium)
            .buttonStyle(.bordered)
            .tint(theme.palette.onSurfaceVariant)
            .frame(maxWidth: .infinity)
            .disabled(saving)

            Button(action: onSave) {
                if saving {
                    HStack(spacing: 8) {
                        ProgressView().tint(theme.palette.onPrimary)
                        Text(savingLabel)
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    // ⚠ 아이콘을 붙이지 않는다 — 안드로이드는 글자만이고, 캘린더 아이콘은
                    // '일정에 추가' 라는 다른 동작을 연상시킨다.
                    Text(saveTitle).frame(maxWidth: .infinity)
                }
            }
            .frame(minHeight: 52)
            .font(theme.typography.titleMedium)
            .buttonStyle(.borderedProminent)
            .tint(theme.palette.primary)
            .frame(maxWidth: .infinity)
            .disabled(!saveEnabled || saving)
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(theme.palette.background)
    }
}
