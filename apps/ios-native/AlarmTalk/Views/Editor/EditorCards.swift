import SwiftUI

/// 편집기 섹션 제목 — 카드 **밖** 위쪽. 안드로이드 `EditorSectionTitle`.
struct EditorSectionTitle: View {
    @Environment(\.voiceAlarmTheme) private var theme
    let text: LocalizedStringKey

    var body: some View {
        Text(text)
            // 안드로이드 `EditorSectionTitle` 과 같다 — titleSmall · SemiBold · onSurfaceVariant(2026-11-15 전까지 iOS 만 흰 굵은 글자).
            .font(theme.typography.titleSmall)
            .fontWeight(.semibold)
            .foregroundStyle(theme.palette.onSurfaceVariant)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// 편집기 카드 표면 — `WakerCardShape`(22) + surface + cardBorder 1pt(안드로이드 `wakerCardBorder` — 다크 #5A6A9C, 홈 카드와 같은 선).
///
/// ⚠ **iOS 기본 `Form`/`Section` 으로 돌아가지 말 것.** `Form` 은 iOS 표준 그룹 목록
/// 모양을 강제해(회색 배경 위 흰 그룹, 자체 여백·구분선) 안드로이드의 Waker 카드와
/// 나란히 놓으면 다른 앱이 된다. 편집기는 카드 목록이지 설정 폼이 아니다.
struct EditorCard<Content: View>: View {
    @Environment(\.voiceAlarmTheme) private var theme
    var verticalPadding: CGFloat = 4
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, verticalPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            theme.palette.surface,
            in: RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: theme.shapes.vocaCard, style: .continuous)
                .stroke(theme.palette.cardBorder, lineWidth: 1)
        )
    }
}

/// 세부 설정 카드의 한 행 — 제목 + 요약 부제 + 셰브론. 탭하면 상세 pane 으로.
///
/// 안드로이드 `AlarmSettingRow`. **요약이 핵심이다** — 값을 보려고 매번 열어 볼 필요가
/// 없어야 카드 하나로 네 가지 설정이 한눈에 읽힌다.
struct AlarmSettingRow: View {
    @Environment(\.voiceAlarmTheme) private var theme

    let title: String
    let subtitle: String
    let onTap: () -> Void

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
            .buttonStyle(PressScaleButtonStyle())

            Button(action: onTap) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.palette.onSurfaceVariant)
                    .frame(width: 44, height: 44)
                    // ⚠ 없으면 글리프만 눌린다 — `frame`/`padding` 이 넓힌 자리는 투명해 히트테스트를 건너뛴다.
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.vertical, 12)
        .frame(minHeight: 56)
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
/// 하단에 고정했다(`AlarmEditorScreen.kt:1223-1225` 주석).
///
/// ⚠ **저장 중에는 취소도 함께 잠근다.** 저장만 잠그면 사용자가 X 를 눌러 취소한 줄
/// 아는데 몇 초 뒤 알람이 저장·예약되고 탭이 튄다.
struct EditorActionBar: View {
    @Environment(\.voiceAlarmTheme) private var theme

    // ⚠ **`saveTitle` 만 `String` 이다** — 번역은 넘기는 쪽(`saveButtonTitle`)이
    // `String(localized:)` 로 끝내 온다. `savingLabel` 은 항상 리터럴이라 키로 받는다.
    let saveTitle: String
    let saving: Bool
    let savingLabel: LocalizedStringKey
    let saveEnabled: Bool
    let onCancel: () -> Void
    let onSave: () -> Void

    var body: some View {
        // ⚠ **안드로이드 `EditorActionButtons`(`ui/editor/AlarmSnoozeSettings.kt`)와 같은 모양이다**(2026-11-15 오너:
        // "통일할건 통일해봐봐"). 위 구분선(outlineVariant) · 좌우 16 · 버튼 간격 12 · 높이 40 · 모서리 18
        // (`WakerButtonShape`) · 취소는 테두리(outline)만 있고 글자는 primary · 저장은 primary 채움에 onPrimary 글자.
        // 예전 iOS 는 시스템 `.bordered`·`.borderedProminent` 라 캡슐 모양에 취소는 회색 채움, 저장은 흰 글자였다
        // (밝은 파랑 위 흰 글자는 대비도 모자랐다).
        VStack(spacing: 0) {
            Rectangle()
                .fill(theme.palette.outlineVariant)
                .frame(height: 1)
            HStack(spacing: 12) {
                Button(action: onCancel) {
                    Text("취소")
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
                .buttonStyle(EditorActionButtonStyle(kind: .outlined))
                .disabled(saving)

                Button(action: onSave) {
                    // ⚠ **큰 글꼴에서 라벨이 잘리지 않게 줄어들게 한다**(`minimumScaleFactor`).
                    // 접근성 글꼴을 키운 기기에서 그냥 두면 버튼이 두 줄로 번진다.
                    // 안드로이드도 같은 자리를 줄인다 — `EditorActionButtons` 가 `fitToWidthScale(..., minimumScale = 0.7f)`.
                    if saving {
                        HStack(spacing: 8) {
                            // 저장 중에는 버튼이 잠겨 있으므로 잠긴 글자색(onSurfaceVariant)을 따른다(안드로이드 `LocalContentColor`).
                            ProgressView()
                                .controlSize(.small)
                                .tint(theme.palette.onSurfaceVariant)
                            Text(savingLabel)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                        }
                    } else {
                        // ⚠ 아이콘을 붙이지 않는다 — 안드로이드는 글자만이고, 캘린더 아이콘은
                        // '일정에 추가' 라는 다른 동작을 연상시킨다.
                        Text(saveTitle)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                }
                .buttonStyle(EditorActionButtonStyle(kind: .filled))
                .disabled(!saveEnabled || saving)
            }
            .padding(.horizontal, 16)
            // 버튼은 40 으로 그리고 눌리는 영역은 44 다(위아래 2씩) — 구분선에서 버튼까지 8 + 2 = 안드로이드의 10.
            // 아래는 홈 인디케이터 안전영역이 대신한다(2026-08-10 "위아래 여분이 너무 크다").
            .padding(.top, 8)
        }
        .background(theme.palette.background)
    }
}

/// 편집기 하단 버튼 모양 — 안드로이드 Material `OutlinedButton`·`Button`(+ `wakerButtonColors`)과 같은 값.
private struct EditorActionButtonStyle: ButtonStyle {
    enum Kind { case outlined, filled }
    let kind: Kind

    func makeBody(configuration: Configuration) -> some View {
        EditorActionButtonBody(label: configuration.label, isPressed: configuration.isPressed, kind: kind)
    }
}

private struct EditorActionButtonBody: View {
    @Environment(\.voiceAlarmTheme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    let label: ButtonStyleConfiguration.Label
    let isPressed: Bool
    let kind: EditorActionButtonStyle.Kind

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.shapes.vocaButton, style: .continuous)
        // ⚠ 프레임을 **스타일 안에서** 준다 — 두 버튼이 5:5 로 나뉘고, 그려지는 40 바깥 44 까지 눌린다.
        label
            .font(theme.typography.labelLarge)
            .foregroundStyle(foreground)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(fill, in: shape)
            .overlay {
                if kind == .outlined {
                    shape.strokeBorder(border, lineWidth: 1)
                }
            }
            .opacity(isPressed ? 0.8 : 1)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
    }

    // 안드로이드: 채움 = primary/onPrimary, 잠김 surfaceVariant/onSurfaceVariant(`wakerButtonColors`).
    // 테두리 = 글자 primary·선 outline, 잠김 글자 onSurface 38%·선 onSurface 12%(Material 기본값).
    private var fill: Color {
        switch kind {
        case .outlined: return .clear
        case .filled: return isEnabled ? theme.palette.primary : theme.palette.surfaceVariant
        }
    }

    private var foreground: Color {
        switch kind {
        case .outlined: return isEnabled ? theme.palette.primary : theme.palette.onSurface.opacity(0.38)
        case .filled: return isEnabled ? theme.palette.onPrimary : theme.palette.onSurfaceVariant
        }
    }

    private var border: Color {
        isEnabled ? theme.palette.outline : theme.palette.onSurface.opacity(0.12)
    }
}
